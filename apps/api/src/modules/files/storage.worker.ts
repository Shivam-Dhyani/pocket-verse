import { rm } from 'node:fs/promises';
import type { PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
import type { MasterKeyring } from '../../lib/crypto/index.js';
import type { KeyedMutex } from '../../lib/mutex.js';
import type { TelegramGateway } from '../../lib/telegram/gateway.js';
import type { FinalFailureHandler, JobHandlers } from '../../lib/queue/index.js';
import { AuditEventTypes, type AuditService } from '../audit/audit.service.js';
import { decryptConnectionSession, requireChannel } from '../connection/session.js';

export interface StorageWorkerDeps {
  prisma: PrismaClient;
  gateway: TelegramGateway;
  keyring: MasterKeyring;
  audit: AuditService;
  lock: KeyedMutex;
  logger: Logger;
}

/**
 * Queue-side of the storage engine. Jobs are retried by the queue with
 * exponential backoff (FLOOD_WAIT-aware: short waits are absorbed inside the
 * gateway, longer ones fail the attempt and ride the backoff schedule).
 */
export function createStorageWorker({
  prisma,
  gateway,
  keyring,
  audit,
  lock,
  logger,
}: StorageWorkerDeps): { handlers: JobHandlers; onFinalFailure: FinalFailureHandler } {
  const handlers: JobHandlers = {
    async 'chunk-upload'({ fileId, chunkIndex, stagingPath }) {
      const chunk = await prisma.fileChunk.findUnique({
        where: { fileId_index: { fileId, index: chunkIndex } },
        include: { file: true },
      });
      if (!chunk || chunk.status === 'UPLOADED') {
        // File deleted mid-upload or duplicate delivery — nothing to do.
        await rm(stagingPath, { force: true });
        return;
      }

      const connection = await prisma.storageConnection.findUnique({
        where: { userId: chunk.file.ownerId },
      });
      if (!connection || connection.status !== 'CONNECTED') {
        throw new Error('Storage connection unavailable for chunk upload');
      }

      await prisma.fileChunk.update({
        where: { id: chunk.id },
        data: { status: 'UPLOADING', attempts: { increment: 1 } },
      });

      const session = decryptConnectionSession(connection, keyring);
      const startedAt = Date.now();
      const sizeMb = (Number(chunk.size) / 1024 / 1024).toFixed(1);
      logger.info(
        { fileId, chunkIndex, sizeMb, fileName: chunk.file.name },
        'Chunk transfer to storage started',
      );

      let lastLoggedDecile = 0;
      const { messageId } = await lock(chunk.file.ownerId, () =>
        gateway.uploadFile(session, requireChannel(connection), {
          path: stagingPath,
          fileName:
            chunk.file.totalChunks === 1
              ? chunk.file.name
              : `${chunk.file.name}.pvchunk${String(chunkIndex).padStart(4, '0')}`,
          fileSize: Number(chunk.size),
          caption: `pocketverse:${fileId}:${chunkIndex}`,
          onProgress: (fraction) => {
            const decile = Math.floor(fraction * 10);
            if (decile > lastLoggedDecile) {
              lastLoggedDecile = decile;
              logger.info({ fileId, chunkIndex, percent: decile * 10 }, 'Chunk transfer progress');
              // Persisted so the UI's "syncing… N%" stays honest. Fire-and-forget:
              // progress display must never stall the transfer itself.
              void prisma.fileChunk
                .update({ where: { id: chunk.id }, data: { progress: decile * 10 } })
                .catch(() => undefined);
            }
          },
        }),
      );
      logger.info(
        { fileId, chunkIndex, sizeMb, seconds: Math.round((Date.now() - startedAt) / 1000) },
        'Chunk transfer to storage finished',
      );

      await prisma.fileChunk.update({
        where: { id: chunk.id },
        data: { status: 'UPLOADED', telegramMessageId: messageId, progress: 100 },
      });
      await rm(stagingPath, { force: true });

      const remaining = await prisma.fileChunk.count({
        where: { fileId, status: { not: 'UPLOADED' } },
      });
      if (remaining === 0) {
        await prisma.file.update({ where: { id: fileId }, data: { status: 'READY' } });
        await audit.record(chunk.file.ownerId, AuditEventTypes.FILE_UPLOADED, {
          fileId,
          name: chunk.file.name,
          size: Number(chunk.file.size),
        });
      }
    },

    async 'messages-delete'({ userId, messageIds }) {
      const connection = await prisma.storageConnection.findUnique({ where: { userId } });
      if (!connection || connection.status !== 'CONNECTED') {
        // Session gone (user disconnected) — the messages stay in THEIR
        // account, which they control. Nothing more we can or should do.
        logger.warn({ count: messageIds.length }, 'Skipping message deletion: no connection');
        return;
      }
      logger.info({ count: messageIds.length }, 'Deleting chunk messages from storage');
      const session = decryptConnectionSession(connection, keyring);
      const { deletedCount } = await lock(userId, () =>
        gateway.deleteMessages(session, requireChannel(connection), messageIds),
      );
      if (deletedCount < messageIds.length) {
        // Not fatal (some may have been deleted manually already) — but never silent.
        logger.warn(
          { requested: messageIds.length, deletedCount },
          'Storage reported fewer deletions than requested',
        );
      } else {
        logger.info({ deletedCount }, 'Chunk messages deleted from storage');
      }
    },
  };

  const onFinalFailure: FinalFailureHandler = async (name, payload, error) => {
    if (name === 'chunk-upload') {
      const { fileId, chunkIndex, stagingPath } = payload as {
        fileId: string;
        chunkIndex: number;
        stagingPath: string;
      };
      logger.error({ err: error, fileId, chunkIndex }, 'Chunk upload failed permanently');
      await rm(stagingPath, { force: true }).catch(() => undefined);
      await prisma.fileChunk
        .updateMany({
          where: { fileId, index: chunkIndex },
          data: { status: 'ERROR' },
        })
        .catch(() => undefined);
      const file = await prisma.file
        .update({ where: { id: fileId }, data: { status: 'ERROR' } })
        .catch(() => undefined);
      if (file) {
        await audit.record(file.ownerId, AuditEventTypes.FILE_UPLOAD_FAILED, {
          fileId,
          name: file.name,
        });
      }
      return;
    }
    logger.error({ err: error, job: name }, 'Job failed permanently');
  };

  return { handlers, onFinalFailure };
}
