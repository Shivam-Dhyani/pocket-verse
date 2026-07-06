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

export function createFakePrisma() {
  const users = new Map<string, UserRow>();
  const refreshTokens = new Map<string, RefreshTokenRow>();

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
    /** Test-only inspection helpers. */
    _state: { users, refreshTokens },
  };

  return fake as unknown as PrismaClient & { _state: typeof fake._state };
}
