import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';

/**
 * Minimal in-memory stand-in for the Prisma client, implementing exactly the
 * calls the auth service makes. Route/service tests run against this; real-DB
 * verification happens in local dev with Postgres (see README).
 */

interface UserRow {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: Date;
  updatedAt: Date;
}

interface RefreshTokenRow {
  id: string;
  tokenHash: string;
  userId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
}

interface StorageConnectionRow {
  id: string;
  userId: string;
  status: 'PENDING_CODE' | 'PENDING_PASSWORD' | 'CONNECTED' | 'ERROR';
  phoneMasked: string;
  wrappedDataKey: string;
  encryptedSession: string | null;
  encryptedPending: string | null;
  pendingExpiresAt: Date | null;
  channelId: string | null;
  channelAccessHash: string | null;
  lastCheckedAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface AuditEventRow {
  id: string;
  userId: string;
  type: string;
  metadata: unknown;
  createdAt: Date;
}

export function createFakePrisma() {
  const users = new Map<string, UserRow>();
  const refreshTokens = new Map<string, RefreshTokenRow>();
  const connections = new Map<string, StorageConnectionRow>();
  const auditEvents: AuditEventRow[] = [];

  const findConnection = (where: { userId?: string; id?: string }) => {
    for (const row of connections.values()) {
      if ((where.userId && row.userId === where.userId) || (where.id && row.id === where.id)) {
        return row;
      }
    }
    return null;
  };

  const fake = {
    user: {
      findUnique: async ({ where }: { where: { email?: string; id?: string } }) => {
        for (const user of users.values()) {
          if ((where.email && user.email === where.email) || (where.id && user.id === where.id)) {
            return { ...user };
          }
        }
        return null;
      },
      create: async ({ data }: { data: { email: string; passwordHash: string } }) => {
        const now = new Date();
        const user: UserRow = { id: randomUUID(), createdAt: now, updatedAt: now, ...data };
        users.set(user.id, user);
        return { ...user };
      },
    },
    refreshToken: {
      create: async ({
        data,
      }: {
        data: { tokenHash: string; userId: string; expiresAt: Date };
      }) => {
        const row: RefreshTokenRow = {
          id: randomUUID(),
          revokedAt: null,
          createdAt: new Date(),
          ...data,
        };
        refreshTokens.set(row.id, row);
        return { ...row };
      },
      findUnique: async ({
        where,
        include,
      }: {
        where: { tokenHash: string };
        include?: { user?: boolean };
      }) => {
        for (const row of refreshTokens.values()) {
          if (row.tokenHash === where.tokenHash) {
            const user = include?.user ? users.get(row.userId) : undefined;
            return { ...row, ...(include?.user ? { user: user ? { ...user } : null } : {}) };
          }
        }
        return null;
      },
      update: async ({ where, data }: { where: { id: string }; data: { revokedAt?: Date } }) => {
        const row = refreshTokens.get(where.id);
        if (!row) {
          throw new Error('Record not found');
        }
        Object.assign(row, data);
        return { ...row };
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { userId?: string; tokenHash?: string; revokedAt?: null };
        data: { revokedAt?: Date };
      }) => {
        let count = 0;
        for (const row of refreshTokens.values()) {
          const matches =
            (where.userId === undefined || row.userId === where.userId) &&
            (where.tokenHash === undefined || row.tokenHash === where.tokenHash) &&
            (!('revokedAt' in where) || row.revokedAt === where.revokedAt);
          if (matches) {
            Object.assign(row, data);
            count += 1;
          }
        }
        return { count };
      },
    },
    storageConnection: {
      findUnique: async ({ where }: { where: { userId?: string; id?: string } }) => {
        const row = findConnection(where);
        return row ? { ...row } : null;
      },
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { userId: string };
        create: Pick<StorageConnectionRow, 'userId' | 'status' | 'phoneMasked' | 'wrappedDataKey'> &
          Partial<StorageConnectionRow>;
        update: Partial<StorageConnectionRow>;
      }) => {
        const existing = findConnection(where);
        if (existing) {
          Object.assign(existing, update, { updatedAt: new Date() });
          return { ...existing };
        }
        const now = new Date();
        const row: StorageConnectionRow = {
          id: randomUUID(),
          createdAt: now,
          updatedAt: now,
          encryptedSession: null,
          encryptedPending: null,
          pendingExpiresAt: null,
          channelId: null,
          channelAccessHash: null,
          lastCheckedAt: null,
          lastError: null,
          ...create,
        };
        connections.set(row.id, row);
        return { ...row };
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Partial<StorageConnectionRow>;
      }) => {
        const row = connections.get(where.id);
        if (!row) {
          throw new Error('Record not found');
        }
        Object.assign(row, data, { updatedAt: new Date() });
        return { ...row };
      },
      delete: async ({ where }: { where: { id: string } }) => {
        const row = connections.get(where.id);
        if (!row) {
          throw new Error('Record not found');
        }
        connections.delete(where.id);
        return { ...row };
      },
    },
    auditEvent: {
      create: async ({ data }: { data: { userId: string; type: string; metadata?: unknown } }) => {
        const row: AuditEventRow = {
          id: randomUUID(),
          metadata: null,
          createdAt: new Date(),
          ...data,
        };
        auditEvents.push(row);
        return { ...row };
      },
    },
    /** Test-only inspection helpers. */
    _state: { users, refreshTokens, connections, auditEvents },
  };

  return fake as unknown as PrismaClient & { _state: typeof fake._state };
}
