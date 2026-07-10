import type { PrismaClient, StorageConnection } from '@prisma/client';
import type { ConnectionDto } from '@pocketverse/shared';
import {
  createWrappedDataKey,
  decryptWithDataKey,
  encryptWithDataKey,
  type MasterKeyring,
} from '../../lib/crypto/index.js';
import type { KeyedMutex } from '../../lib/mutex.js';
import type { StorageChannelInfo, TelegramGateway } from '../../lib/telegram/gateway.js';
import { AppError } from '../../middleware/errors.js';
import { AuditEventTypes, type AuditService } from '../audit/audit.service.js';

/** A pending phone→code→password flow is valid this long before restarting. */
const PENDING_TTL_MS = 10 * 60 * 1000;

interface PendingBlob {
  tempSession: string;
  phoneCodeHash: string;
  phone: string;
}

export interface ConnectionServiceDeps {
  prisma: PrismaClient;
  gateway: TelegramGateway;
  keyring: MasterKeyring;
  audit: AuditService;
  lock: KeyedMutex;
}

const noPendingError = () =>
  new AppError(
    400,
    'NO_PENDING_CONNECTION',
    'No sign-in attempt is in progress. Start the connection again.',
  );

const pendingExpiredError = () =>
  new AppError(
    400,
    'PENDING_EXPIRED',
    'This sign-in attempt expired. Start the connection again to get a new code.',
  );

export function createConnectionService({
  prisma,
  gateway,
  keyring,
  audit,
  lock,
}: ConnectionServiceDeps) {
  const aad = (userId: string) => `user:${userId}:connection`;

  function encryptPending(connection: StorageConnection, blob: PendingBlob): string {
    return encryptWithDataKey(
      JSON.stringify(blob),
      connection.wrappedDataKey,
      keyring,
      aad(connection.userId),
    );
  }

  function decryptPending(connection: StorageConnection): PendingBlob {
    if (!connection.encryptedPending) {
      throw noPendingError();
    }
    const plaintext = decryptWithDataKey(
      connection.encryptedPending,
      connection.wrappedDataKey,
      keyring,
      aad(connection.userId),
    );
    return JSON.parse(plaintext.toString('utf8')) as PendingBlob;
  }

  function decryptSession(connection: StorageConnection): string {
    if (!connection.encryptedSession) {
      throw new AppError(
        400,
        'NOT_CONNECTED',
        'No storage connection yet. Connect your account first.',
      );
    }
    return decryptWithDataKey(
      connection.encryptedSession,
      connection.wrappedDataKey,
      keyring,
      aad(connection.userId),
    ).toString('utf8');
  }

  function assertPendingFresh(connection: StorageConnection): void {
    if (!connection.pendingExpiresAt || connection.pendingExpiresAt.getTime() <= Date.now()) {
      throw pendingExpiredError();
    }
  }

  async function finalize(connection: StorageConnection, session: string): Promise<ConnectionDto> {
    const channel = await gateway.createStorageChannel(session);
    const updated = await prisma.storageConnection.update({
      where: { id: connection.id },
      data: {
        status: 'CONNECTED',
        encryptedSession: encryptWithDataKey(
          session,
          connection.wrappedDataKey,
          keyring,
          aad(connection.userId),
        ),
        encryptedPending: null,
        pendingExpiresAt: null,
        channelId: channel.channelId,
        channelAccessHash: channel.accessHash,
        lastCheckedAt: new Date(),
        lastError: null,
      },
    });
    await audit.record(connection.userId, AuditEventTypes.CONNECTION_CONNECTED, {
      phoneMasked: connection.phoneMasked,
    });
    return toDto(updated);
  }

  return {
    async start(userId: string, phone: string): Promise<ConnectionDto> {
      return lock(userId, async () => {
        const existing = await prisma.storageConnection.findUnique({ where: { userId } });
        if (existing?.status === 'CONNECTED') {
          throw new AppError(
            409,
            'ALREADY_CONNECTED',
            'Your storage is already connected. Disconnect first to connect a different account.',
          );
        }

        const sent = await gateway.sendCode(phone);
        const phoneMasked = maskPhone(phone);
        const { wrappedKey } = createWrappedDataKey(keyring, aad(userId));

        const base = {
          status: 'PENDING_CODE' as const,
          phoneMasked,
          wrappedDataKey: wrappedKey,
          encryptedSession: null,
          pendingExpiresAt: new Date(Date.now() + PENDING_TTL_MS),
          channelId: null,
          channelAccessHash: null,
          lastError: null,
        };
        // Each start gets a fresh data key, so encrypt against the new row values.
        const pendingFor = (connection: StorageConnection) =>
          encryptPending(connection, {
            tempSession: sent.tempSession,
            phoneCodeHash: sent.phoneCodeHash,
            phone,
          });

        const created = await prisma.storageConnection.upsert({
          where: { userId },
          create: { userId, ...base },
          update: base,
        });
        const updated = await prisma.storageConnection.update({
          where: { id: created.id },
          data: { encryptedPending: pendingFor(created) },
        });

        await audit.record(userId, AuditEventTypes.CONNECTION_STARTED, { phoneMasked });
        return toDto(updated);
      });
    },

    async verifyCode(userId: string, code: string): Promise<ConnectionDto> {
      return lock(userId, async () => {
        const connection = await prisma.storageConnection.findUnique({ where: { userId } });
        if (!connection || connection.status !== 'PENDING_CODE') {
          throw noPendingError();
        }
        assertPendingFresh(connection);

        const pending = decryptPending(connection);
        const result = await gateway.signInWithCode({
          tempSession: pending.tempSession,
          phone: pending.phone,
          phoneCodeHash: pending.phoneCodeHash,
          code,
        });

        if (result.kind === 'password_needed') {
          const updated = await prisma.storageConnection.update({
            where: { id: connection.id },
            data: {
              status: 'PENDING_PASSWORD',
              pendingExpiresAt: new Date(Date.now() + PENDING_TTL_MS),
            },
          });
          return toDto(updated);
        }

        return finalize(connection, result.session);
      });
    },

    async verifyPassword(userId: string, password: string): Promise<ConnectionDto> {
      return lock(userId, async () => {
        const connection = await prisma.storageConnection.findUnique({ where: { userId } });
        if (!connection || connection.status !== 'PENDING_PASSWORD') {
          throw noPendingError();
        }
        assertPendingFresh(connection);

        const pending = decryptPending(connection);
        const { session } = await gateway.signInWithPassword({
          tempSession: pending.tempSession,
          password,
        });
        return finalize(connection, session);
      });
    },

    async getStatus(userId: string): Promise<ConnectionDto> {
      const connection = await prisma.storageConnection.findUnique({ where: { userId } });
      return connection ? toDto(connection) : emptyDto();
    },

    async check(userId: string): Promise<ConnectionDto> {
      return lock(userId, async () => {
        const connection = await prisma.storageConnection.findUnique({ where: { userId } });
        if (!connection || (connection.status !== 'CONNECTED' && connection.status !== 'ERROR')) {
          throw new AppError(
            400,
            'NOT_CONNECTED',
            'No storage connection yet. Connect your account first.',
          );
        }

        const session = decryptSession(connection);
        const channel: StorageChannelInfo | undefined =
          connection.channelId && connection.channelAccessHash
            ? { channelId: connection.channelId, accessHash: connection.channelAccessHash }
            : undefined;

        try {
          await gateway.checkHealth(session, channel);
          const updated = await prisma.storageConnection.update({
            where: { id: connection.id },
            data: { status: 'CONNECTED', lastCheckedAt: new Date(), lastError: null },
          });
          return toDto(updated);
        } catch (error) {
          const message =
            error instanceof AppError ? error.message : 'The storage connection is not responding.';
          const updated = await prisma.storageConnection.update({
            where: { id: connection.id },
            data: { status: 'ERROR', lastCheckedAt: new Date(), lastError: message },
          });
          await audit.record(userId, AuditEventTypes.CONNECTION_HEALTH_FAILED);
          return toDto(updated);
        }
      });
    },

    async disconnect(userId: string): Promise<void> {
      return lock(userId, async () => {
        const connection = await prisma.storageConnection.findUnique({ where: { userId } });
        if (!connection) {
          throw new AppError(404, 'NOT_CONNECTED', 'There is no storage connection to remove.');
        }

        if (connection.encryptedSession) {
          // Best-effort remote invalidation; local deletion happens regardless.
          try {
            await gateway.logOut(decryptSession(connection));
          } catch {
            // The session may already be dead — that's fine, we're removing it.
          }
        }

        // A connection provisions its OWN private channel, and file metadata
        // points at messages in that channel. Once disconnected we can no
        // longer reach it, so keeping the metadata would leave "ghost" files
        // that list but can't open or download. Purge the user's drive so a
        // reconnect starts clean. (The bytes remain safe in the user's own
        // channel — we simply stop tracking them.)
        await prisma.file.deleteMany({ where: { ownerId: userId } });
        await prisma.folder.deleteMany({ where: { ownerId: userId } });

        await prisma.storageConnection.delete({ where: { id: connection.id } });
        await audit.record(userId, AuditEventTypes.CONNECTION_DISCONNECTED, {
          phoneMasked: connection.phoneMasked,
        });
      });
    },
  };
}

export type ConnectionService = ReturnType<typeof createConnectionService>;

function toDto(connection: StorageConnection): ConnectionDto {
  const statusMap = {
    PENDING_CODE: 'pending_code',
    PENDING_PASSWORD: 'pending_password',
    CONNECTED: 'connected',
    ERROR: 'error',
  } as const;
  return {
    status: statusMap[connection.status],
    phoneMasked: connection.phoneMasked,
    channelReady: Boolean(connection.channelId),
    lastCheckedAt: connection.lastCheckedAt?.toISOString() ?? null,
    lastError: connection.lastError,
  };
}

function emptyDto(): ConnectionDto {
  return {
    status: 'none',
    phoneMasked: null,
    channelReady: false,
    lastCheckedAt: null,
    lastError: null,
  };
}

export function maskPhone(phone: string): string {
  if (phone.length <= 7) {
    return `${phone.slice(0, 2)}•••${phone.slice(-2)}`;
  }
  return `${phone.slice(0, 3)}${'•'.repeat(phone.length - 7)}${phone.slice(-4)}`;
}
