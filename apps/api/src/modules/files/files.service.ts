import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm, stat, truncate } from 'node:fs/promises';
import path from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { File as FileRow, PrismaClient, UploadSession } from '@prisma/client';
import type {
  CreateUploadInput,
  FileDto,
  SearchResultDto,
  UpdateFileInput,
  UploadSessionDto,
} from '@pocketverse/shared';
import type { MasterKeyring } from '../../lib/crypto/index.js';
import type { JobQueue } from '../../lib/queue/index.js';
import type { TelegramGateway } from '../../lib/telegram/gateway.js';
import { AppError } from '../../middleware/errors.js';
import { AuditEventTypes, type AuditService } from '../audit/audit.service.js';
import {
  decryptConnectionSession,
  notConnectedError,
  requireChannel,
} from '../connection/session.js';

const UPLOAD_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const DELETE_BATCH_SIZE = 100;

export interface FilesServiceConfig {
  chunkSizeBytes: number;
  partSizeBytes: number;
  stagingDir: string;
}

export interface FilesServiceDeps {
  prisma: PrismaClient;
  keyring: MasterKeyring;
  gateway: TelegramGateway;
  queue: JobQueue;
  audit: AuditService;
  config: FilesServiceConfig;
}

const notFound = () => new AppError(404, 'NOT_FOUND', 'Resource not found');

export function createFilesService({
  prisma,
  keyring,
  gateway,
  queue,
  audit,
  config,
}: FilesServiceDeps) {
  const partSize = config.partSizeBytes;
  // Chunks must be an exact multiple of the part size so no HTTP part ever
  // straddles a chunk boundary.
  const chunkSize = Math.max(partSize, Math.floor(config.chunkSizeBytes / partSize) * partSize);
  const partsPerChunk = chunkSize / partSize;

  const stagingPathFor = (fileId: string, chunkIndex: number) =>
    path.join(config.stagingDir, fileId, `chunk-${chunkIndex}.part`);

  async function requireConnected(userId: string) {
    const connection = await prisma.storageConnection.findUnique({ where: { userId } });
    if (!connection || connection.status !== 'CONNECTED') {
      throw notConnectedError();
    }
    return connection;
  }

  async function requireSession(userId: string, uploadId: string) {
    const session = await prisma.uploadSession.findUnique({
      where: { id: uploadId },
      include: { file: true },
    });
    if (!session || session.ownerId !== userId) {
      throw notFound();
    }
    if (session.expiresAt.getTime() <= Date.now()) {
      throw new AppError(410, 'UPLOAD_EXPIRED', 'This upload expired. Start it again.');
    }
    return session;
  }

  function expectedPartBytes(session: UploadSession, fileSize: bigint, partIndex: number): number {
    if (partIndex < session.totalParts - 1) {
      return session.partSize;
    }
    return Number(fileSize - BigInt(session.partSize) * BigInt(session.totalParts - 1));
  }

  async function fileChecksum(fileId: string, totalChunks: number): Promise<string | null> {
    const chunks = await prisma.fileChunk.findMany({
      where: { fileId },
      orderBy: { index: 'asc' },
      select: { checksum: true },
    });
    if (chunks.some((chunk) => !chunk.checksum)) {
      return null;
    }
    if (totalChunks === 1) {
      return chunks[0]?.checksum ?? null;
    }
    const hash = createHash('sha256');
    for (const chunk of chunks) {
      hash.update(chunk.checksum as string);
    }
    return `composite:${hash.digest('hex')}`;
  }

  return {
    async createUpload(userId: string, input: CreateUploadInput): Promise<UploadSessionDto> {
      await requireConnected(userId);
      if (input.folderId) {
        const folder = await prisma.folder.findUnique({ where: { id: input.folderId } });
        if (!folder || folder.ownerId !== userId) {
          throw notFound();
        }
      }

      const totalChunks = Math.ceil(input.size / chunkSize);
      const totalParts = Math.ceil(input.size / partSize);
      // With nosniff, the browser trusts our Content-Type exactly — so back-fill
      // a real type from the extension when the client didn't provide one.
      const mimeType = resolveMimeType(input.mimeType, input.name);

      const file = await prisma.file.create({
        data: {
          name: input.name,
          size: BigInt(input.size),
          mimeType,
          status: 'UPLOADING',
          totalChunks,
          folderId: input.folderId ?? null,
          ownerId: userId,
          chunks: {
            create: Array.from({ length: totalChunks }, (_, index) => ({
              index,
              size: BigInt(Math.min(chunkSize, input.size - index * chunkSize)),
            })),
          },
          uploadSession: {
            create: {
              ownerId: userId,
              partSize,
              chunkSize,
              totalParts,
              expiresAt: new Date(Date.now() + UPLOAD_SESSION_TTL_MS),
            },
          },
        },
        include: { uploadSession: true },
      });

      await mkdir(path.join(config.stagingDir, file.id), { recursive: true });
      return toUploadDto(file.uploadSession as UploadSession, file);
    },

    async getUpload(userId: string, uploadId: string): Promise<UploadSessionDto> {
      const session = await requireSession(userId, uploadId);
      return toUploadDto(session, session.file);
    },

    /** Sequential resumable part upload. Body is streamed to disk, never buffered. */
    async uploadPart(
      userId: string,
      uploadId: string,
      partIndex: number,
      body: Readable,
    ): Promise<UploadSessionDto> {
      const session = await requireSession(userId, uploadId);
      const file = session.file;
      if (file.status !== 'UPLOADING') {
        throw new AppError(409, 'UPLOAD_FINISHED', 'This upload has already finished.');
      }
      if (!Number.isInteger(partIndex) || partIndex !== session.nextPart) {
        throw new AppError(409, 'PART_OUT_OF_ORDER', 'Parts must be uploaded in order.', {
          nextPart: session.nextPart,
        });
      }

      const chunkIndex = Math.floor(partIndex / partsPerChunk);
      const offsetInChunk = (partIndex % partsPerChunk) * session.partSize;
      const stagingPath = stagingPathFor(file.id, chunkIndex);
      await mkdir(path.dirname(stagingPath), { recursive: true });

      // Staging must be exactly at this part's offset. If it isn't (host
      // restarted and lost the disk), the whole chunk restarts — honestly.
      const stagedBytes = await stat(stagingPath).then(
        (s) => s.size,
        () => 0,
      );
      if (stagedBytes !== offsetInChunk) {
        await rm(stagingPath, { force: true });
        const chunkFirstPart = chunkIndex * partsPerChunk;
        const updated = await prisma.uploadSession.update({
          where: { id: session.id },
          data: { nextPart: chunkFirstPart },
        });
        throw new AppError(
          409,
          'STAGING_LOST',
          'The server lost this chunk’s staged data (likely a restart). Resume from the reported part.',
          { nextPart: updated.nextPart },
        );
      }

      const expected = expectedPartBytes(session, file.size, partIndex);
      let received = 0;
      const guard = new Transform({
        transform(data: Buffer, _encoding, callback) {
          received += data.length;
          if (received > expected) {
            callback(new AppError(400, 'PART_SIZE_MISMATCH', `Expected ${expected} bytes`));
            return;
          }
          callback(null, data);
        },
      });

      try {
        await pipeline(body, guard, createWriteStream(stagingPath, { flags: 'a' }));
        if (received !== expected) {
          throw new AppError(
            400,
            'PART_SIZE_MISMATCH',
            `Expected ${expected} bytes, received ${received}`,
          );
        }
      } catch (error) {
        // Roll the staged chunk back to this part's start so a retry is clean.
        await truncate(stagingPath, offsetInChunk).catch(() => undefined);
        throw error instanceof AppError
          ? error
          : new AppError(400, 'PART_UPLOAD_FAILED', 'The part upload was interrupted. Retry it.');
      }

      const isLastPartOfFile = partIndex === session.totalParts - 1;
      const isLastPartOfChunk = isLastPartOfFile || (partIndex + 1) % partsPerChunk === 0;

      if (isLastPartOfChunk) {
        const checksum = await sha256OfFile(stagingPath);
        await prisma.fileChunk.updateMany({
          where: { fileId: file.id, index: chunkIndex },
          data: { checksum },
        });
        await queue.enqueue('chunk-upload', {
          fileId: file.id,
          chunkIndex,
          stagingPath,
        });
      }

      if (isLastPartOfFile) {
        const checksum = await fileChecksum(file.id, file.totalChunks);
        await prisma.file.update({ where: { id: file.id }, data: { checksum } });
        await prisma.uploadSession.delete({ where: { id: session.id } });
        return {
          uploadId: session.id,
          fileId: file.id,
          partSize: session.partSize,
          totalParts: session.totalParts,
          nextPart: session.totalParts,
          fileStatus: 'uploading',
        };
      }

      const updated = await prisma.uploadSession.update({
        where: { id: session.id },
        data: { nextPart: partIndex + 1 },
      });
      return toUploadDto(updated, file);
    },

    async abortUpload(userId: string, uploadId: string): Promise<void> {
      const session = await prisma.uploadSession.findUnique({
        where: { id: uploadId },
        include: { file: { include: { chunks: true } } },
      });
      if (!session || session.ownerId !== userId) {
        throw notFound();
      }
      await removeFileEverywhere(session.file.id, userId, session.file.chunks);
    },

    /** Name search across the whole drive (owner-scoped, case-insensitive). */
    async search(userId: string, query: string): Promise<SearchResultDto[]> {
      const trimmed = query.trim();
      if (!trimmed) {
        return [];
      }
      const files = await prisma.file.findMany({
        where: { ownerId: userId, name: { contains: trimmed, mode: 'insensitive' } },
        orderBy: { name: 'asc' },
        take: 50,
        include: {
          folder: { select: { name: true } },
          chunks: { select: { size: true, status: true, progress: true } },
        },
      });
      return files.map((file) => ({
        ...toFileDto(file, file.chunks),
        folderName: file.folder?.name ?? null,
      }));
    },

    async getFile(userId: string, fileId: string): Promise<FileDto> {
      const file = await prisma.file.findUnique({
        where: { id: fileId },
        include: { chunks: { select: { size: true, status: true, progress: true } } },
      });
      if (!file || file.ownerId !== userId) {
        throw notFound();
      }
      return toFileDto(file, file.chunks);
    },

    /**
     * Streaming download: chunks are fetched in order and yielded as they
     * arrive — nothing is buffered beyond transport pieces.
     */
    async download(userId: string, fileId: string) {
      const file = await prisma.file.findUnique({
        where: { id: fileId },
        include: { chunks: { orderBy: { index: 'asc' } } },
      });
      if (!file || file.ownerId !== userId) {
        throw notFound();
      }
      if (file.status !== 'READY') {
        throw new AppError(
          409,
          'FILE_NOT_READY',
          file.status === 'ERROR'
            ? 'This file failed to upload and cannot be downloaded.'
            : 'This file is still uploading. Try again shortly.',
        );
      }
      const connection = await requireConnected(userId);
      const session = decryptConnectionSession(connection, keyring);
      const channel = requireChannel(connection);
      const chunks = file.chunks;
      const { name: fileName, size: fileSize } = file;

      async function* stream(): AsyncIterable<Buffer> {
        for (const chunk of chunks) {
          if (!chunk.telegramMessageId) {
            throw new AppError(500, 'INTERNAL', 'File metadata is inconsistent.');
          }
          try {
            yield* gateway.downloadChunk(session, channel, chunk.telegramMessageId);
          } catch (error) {
            // The message backing this chunk was deleted in the user's storage
            // (by hand, or the channel itself was removed). Mark the file and
            // write the loss to the activity log so the user can always see
            // exactly what was lost and when.
            if (error instanceof AppError && error.code === 'CHUNK_MISSING') {
              await prisma.file
                .update({ where: { id: fileId }, data: { status: 'ERROR' } })
                .catch(() => undefined);
              await audit.record(userId, AuditEventTypes.FILE_UNREACHABLE, {
                fileId,
                name: fileName,
                size: Number(fileSize),
              });
            }
            // The user ended Pocketverse's session from inside Telegram: flag
            // the connection right here so the drive shows the reconnect
            // banner on the very next status poll — not only after a slow
            // upload-retry cycle finally exhausts.
            if (error instanceof AppError && error.code === 'SESSION_REVOKED') {
              const flagged = await prisma.storageConnection
                .updateMany({
                  where: { userId, status: 'CONNECTED' },
                  data: { status: 'ERROR', lastCheckedAt: new Date(), lastError: error.message },
                })
                .catch(() => ({ count: 0 }));
              if (flagged.count > 0) {
                await audit.record(userId, AuditEventTypes.CONNECTION_SESSION_REVOKED);
              }
            }
            throw error;
          }
        }
      }

      return { file: toFileDto(file), size: file.size, stream: stream() };
    },

    async updateFile(userId: string, fileId: string, input: UpdateFileInput): Promise<FileDto> {
      const file = await prisma.file.findUnique({ where: { id: fileId } });
      if (!file || file.ownerId !== userId) {
        throw notFound();
      }
      if (input.folderId) {
        const folder = await prisma.folder.findUnique({ where: { id: input.folderId } });
        if (!folder || folder.ownerId !== userId) {
          throw notFound();
        }
      }
      const updated = await prisma.file.update({
        where: { id: fileId },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.folderId !== undefined ? { folderId: input.folderId } : {}),
        },
      });
      return toFileDto(updated);
    },

    async deleteFile(userId: string, fileId: string): Promise<void> {
      const file = await prisma.file.findUnique({
        where: { id: fileId },
        include: { chunks: true },
      });
      if (!file || file.ownerId !== userId) {
        throw notFound();
      }
      await removeFileEverywhere(fileId, userId, file.chunks, file.name);
    },

    /**
     * Re-enqueue every failed sync whose staged bytes are still on disk (final
     * failure keeps them for exactly this). Files whose staging is gone (disk
     * wiped by a deploy, or the upload never finished arriving) can't be
     * retried server-side — the bytes only exist on the user's device — so
     * they're reported as needing a fresh upload.
     */
    async retryFailed(userId: string): Promise<{ retried: number; unrecoverable: number }> {
      await requireConnected(userId);
      const files = await prisma.file.findMany({
        where: { ownerId: userId, status: 'ERROR' },
        include: { chunks: { orderBy: { index: 'asc' } } },
      });

      let retried = 0;
      let unrecoverable = 0;
      for (const file of files) {
        const pending = file.chunks.filter((chunk) => chunk.status !== 'UPLOADED');
        const staged = await Promise.all(
          pending.map((chunk) =>
            stat(stagingPathFor(file.id, chunk.index)).then(
              (s) => s.size,
              () => -1,
            ),
          ),
        );
        const recoverable =
          pending.length > 0 &&
          pending.every((chunk, index) => staged[index] === Number(chunk.size));
        if (!recoverable) {
          unrecoverable += 1;
          continue;
        }
        await prisma.fileChunk.updateMany({
          where: { fileId: file.id, status: { not: 'UPLOADED' } },
          data: { status: 'PENDING', progress: 0, attempts: 0 },
        });
        await prisma.file.update({ where: { id: file.id }, data: { status: 'UPLOADING' } });
        for (const chunk of pending) {
          await queue.enqueue('chunk-upload', {
            fileId: file.id,
            chunkIndex: chunk.index,
            stagingPath: stagingPathFor(file.id, chunk.index),
          });
        }
        retried += 1;
      }
      return { retried, unrecoverable };
    },
  };

  async function removeFileEverywhere(
    fileId: string,
    userId: string,
    chunks: { telegramMessageId: string | null }[],
    name?: string,
  ): Promise<void> {
    const messageIds = chunks
      .map((chunk) => chunk.telegramMessageId)
      .filter((id): id is string => Boolean(id));

    await prisma.file.delete({ where: { id: fileId } }); // cascades chunks + session
    await rm(path.join(config.stagingDir, fileId), { recursive: true, force: true });

    for (let start = 0; start < messageIds.length; start += DELETE_BATCH_SIZE) {
      await queue.enqueue('messages-delete', {
        userId,
        messageIds: messageIds.slice(start, start + DELETE_BATCH_SIZE),
      });
    }
    if (name !== undefined) {
      await audit.record(userId, AuditEventTypes.FILE_DELETED, { fileId, name });
    }
  }
}

export type FilesService = ReturnType<typeof createFilesService>;

export interface ChunkProgressInfo {
  size: bigint;
  status: 'PENDING' | 'UPLOADING' | 'UPLOADED' | 'ERROR';
  progress: number;
}

export function toFileDto(file: FileRow, chunks?: ChunkProgressInfo[]): FileDto {
  const statusMap = { UPLOADING: 'uploading', READY: 'ready', ERROR: 'error' } as const;
  return {
    id: file.id,
    name: file.name,
    size: Number(file.size),
    mimeType: file.mimeType,
    status: statusMap[file.status],
    checksum: file.checksum,
    folderId: file.folderId,
    syncProgress: computeSyncProgress(file, chunks),
    createdAt: file.createdAt.toISOString(),
    updatedAt: file.updatedAt.toISOString(),
  };
}

/** Weighted percentage of bytes already safe in storage (uploading files only). */
function computeSyncProgress(file: FileRow, chunks?: ChunkProgressInfo[]): number | null {
  if (file.status !== 'UPLOADING' || !chunks || chunks.length === 0 || file.size === 0n) {
    return null;
  }
  let syncedBytes = 0;
  for (const chunk of chunks) {
    const size = Number(chunk.size);
    syncedBytes += chunk.status === 'UPLOADED' ? size : (size * chunk.progress) / 100;
  }
  return Math.min(100, Math.round((syncedBytes / Number(file.size)) * 100));
}

function toUploadDto(session: UploadSession, file: FileRow): UploadSessionDto {
  const statusMap = { UPLOADING: 'uploading', READY: 'ready', ERROR: 'error' } as const;
  return {
    uploadId: session.id,
    fileId: file.id,
    partSize: session.partSize,
    totalParts: session.totalParts,
    nextPart: session.nextPart,
    fileStatus: statusMap[file.status],
  };
}

const EXTENSION_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  avif: 'image/avif',
  pdf: 'application/pdf',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  zip: 'application/zip',
  txt: 'text/plain',
  json: 'application/json',
};

/** Keep a caller-provided specific type; otherwise infer from the extension. */
export function resolveMimeType(provided: string, name: string): string {
  const trimmed = provided.trim();
  if (trimmed && trimmed !== 'application/octet-stream') {
    return trimmed;
  }
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  return EXTENSION_MIME[ext] ?? 'application/octet-stream';
}

async function sha256OfFile(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const piece of createReadStream(filePath)) {
    hash.update(piece as Buffer);
  }
  return hash.digest('hex');
}
