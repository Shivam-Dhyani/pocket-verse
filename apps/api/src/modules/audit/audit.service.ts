import type { Prisma, PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';

/**
 * Append-only audit trail (logins, connections, deletions). Powers the
 * user-visible activity log in Phase 4 — history can't be backfilled, so
 * recording starts now. Auditing must never break the action it records.
 */

export const AuditEventTypes = {
  AUTH_REGISTER: 'auth.register',
  AUTH_LOGIN: 'auth.login',
  CONNECTION_STARTED: 'connection.started',
  CONNECTION_CONNECTED: 'connection.connected',
  CONNECTION_DISCONNECTED: 'connection.disconnected',
  CONNECTION_HEALTH_FAILED: 'connection.health_failed',
  FILE_UPLOADED: 'file.uploaded',
  FILE_UPLOAD_FAILED: 'file.upload_failed',
  FILE_DELETED: 'file.deleted',
  FOLDER_DELETED: 'folder.deleted',
  /** Disconnect cleared the drive index — records exactly what stopped being
   *  tracked (the bytes stay in the user's own storage channel). */
  DRIVE_INDEX_CLEARED: 'drive.index_cleared',
  /** A file's bytes could not be read from the user's storage (its message was
   *  deleted there by hand) — the user-visible record of what was lost. */
  FILE_UNREACHABLE: 'file.unreachable',
} as const;

export type AuditEventType = (typeof AuditEventTypes)[keyof typeof AuditEventTypes];

export interface AuditService {
  record(userId: string, type: AuditEventType, metadata?: Record<string, unknown>): Promise<void>;
}

export function createAuditService({
  prisma,
  logger,
}: {
  prisma: PrismaClient;
  logger: Logger;
}): AuditService {
  return {
    async record(userId, type, metadata) {
      try {
        await prisma.auditEvent.create({
          data: {
            userId,
            type,
            ...(metadata ? { metadata: metadata as Prisma.InputJsonValue } : {}),
          },
        });
      } catch (error) {
        logger.warn({ err: error, auditType: type }, 'Failed to write audit event');
      }
    },
  };
}
