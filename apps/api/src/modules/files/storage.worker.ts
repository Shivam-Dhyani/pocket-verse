import { rm } from 'node:fs/promises';
import type { PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
import type { MasterKeyring } from '../../lib/crypto/index.js';
import type { KeyedMutex } from '../../lib/mutex.js';
import type { TelegramGateway } from '../../lib/telegram/gateway.js';
import type { FinalFailureHandler, JobHandlers } from '../../lib/queue/index.js';
import { AppError } from '../../middleware/errors.js';
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

      // The file may have been deleted (upload cancelled) while the bytes were
      // in flight to the channel. If its rows are gone, the message we just
      // posted is an orphan — remove it from the user's storage immediately,
      // otherwise a cancelled folder leaves stray chunk messages behind.
      const removeOrphanedMessage = async () => {
        logger.warn({ fileId, chunkIndex }, 'File deleted mid-transfer; removing orphaned message');
        await lock(chunk.file.ownerId, () =>
          gateway.deleteMessages(session, requireChannel(connection), [messageId]),
        ).catch((err: unknown) =>
          logger.error({ err, messageId }, 'Failed to remove orphaned chunk message'),
        );
        await rm(stagingPath, { force: true });
      };

      const survivor = await prisma.fileChunk.findUnique({
        where: { fileId_index: { fileId, index: chunkIndex } },
      });
      if (!survivor) {
        await removeOrphanedMessage();
        return;
      }
      try {
        await prisma.fileChunk.update({
          where: { id: chunk.id },
          data: { status: 'UPLOADED', telegramMessageId: messageId, progress: 100 },
        });
      } catch {
        // Row vanished between the check and the write — same cancel race.
        await removeOrphanedMessage();
        return;
      }
      // Final race window: a delete may have read the chunk (message id still
      // null) just before our write, then removed the rows — its cleanup queue
      // never saw this id. Verify the row survived the write; removing a
      // message twice is harmless, missing one is not.
      const recorded = await prisma.fileChunk
        .findUnique({ where: { fileId_index: { fileId, index: chunkIndex } } })
        .catch(() => null);
      if (!recorded) {
        await removeOrphanedMessage();
        return;
      }
      await rm(stagingPath, { force: true });

      const remaining = await prisma.fileChunk.count({
        where: { fileId, status: { not: 'UPLOADED' } },
      });
      if (remaining === 0) {
        // The file row can also be gone by now (deleted after the last chunk
        // landed). Its chunk messages are handled by the delete flow itself,
        // so a failure here is fine to swallow.
        const updated = await prisma.file
          .update({ where: { id: fileId }, data: { status: 'READY' } })
          .catch(() => null);
        if (updated) {
          await audit.record(chunk.file.ownerId, AuditEventTypes.FILE_UPLOADED, {
            fileId,
            name: chunk.file.name,
            size: Number(chunk.file.size),
          });
        }
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

  /**
   * A SESSION_REVOKED failure means the user ended Pocketverse's session from
   * inside the Telegram app. Mark the connection broken (once) and write the
   * dedicated activity event, so the UI can explain what actually happened
   * instead of showing mysterious upload failures.
   */
  async function flagRevokedSession(userId: string, error: unknown): Promise<void> {
    if (!(error instanceof AppError) || error.code !== 'SESSION_REVOKED') {
      return;
    }
    const connection = await prisma.storageConnection
      .findUnique({ where: { userId } })
      .catch(() => null);
    if (!connection || connection.status === 'ERROR') {
      return; // already flagged (or nothing to flag)
    }
    await prisma.storageConnection
      .update({
        where: { id: connection.id },
        data: { status: 'ERROR', lastCheckedAt: new Date(), lastError: error.message },
      })
      .catch(() => undefined);
    await audit.record(userId, AuditEventTypes.CONNECTION_SESSION_REVOKED);
  }

  const onFinalFailure: FinalFailureHandler = async (name, payload, error) => {
    if (name === 'chunk-upload') {
      const { fileId, chunkIndex } = payload as {
        fileId: string;
        chunkIndex: number;
      };
      logger.error({ err: error, fileId, chunkIndex }, 'Chunk upload failed permanently');
      // Deliberately KEEP the staged bytes: they're what makes "retry failed
      // syncs" possible after the cause (e.g. a revoked session) is fixed.
      // Deleting the file/folder still removes its staging directory.
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
        await flagRevokedSession(file.ownerId, error);
      }
      return;
    }
    if (name === 'messages-delete') {
      const { userId } = payload as { userId: string };
      await flagRevokedSession(userId, error);
    }
    logger.error({ err: error, job: name }, 'Job failed permanently');
  };

  return { handlers, onFinalFailure };
}
