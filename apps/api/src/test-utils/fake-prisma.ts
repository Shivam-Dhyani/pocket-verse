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

interface FolderRow {
  id: string;
  name: string;
  parentId: string | null;
  ownerId: string;
  createdAt: Date;
  updatedAt: Date;
}

interface FileRow {
  id: string;
  name: string;
  size: bigint;
  mimeType: string;
  status: 'UPLOADING' | 'READY' | 'ERROR';
  checksum: string | null;
  totalChunks: number;
  folderId: string | null;
  ownerId: string;
  createdAt: Date;
  updatedAt: Date;
}

interface FileChunkRow {
  id: string;
  fileId: string;
  index: number;
  size: bigint;
  checksum: string | null;
  telegramMessageId: string | null;
  status: 'PENDING' | 'UPLOADING' | 'UPLOADED' | 'ERROR';
  attempts: number;
  progress: number;
}

interface UploadSessionRow {
  id: string;
  fileId: string;
  ownerId: string;
  partSize: number;
  chunkSize: number;
  totalParts: number;
  nextPart: number;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

type IdFilter = string | null | { in: string[] };

function matchesIdFilter(value: string | null, filter: IdFilter | undefined): boolean {
  if (filter === undefined) {
    return true;
  }
  if (filter === null || typeof filter === 'string') {
    return value === filter;
  }
  return value !== null && filter.in.includes(value);
}

export function createFakePrisma() {
  const users = new Map<string, UserRow>();
  const refreshTokens = new Map<string, RefreshTokenRow>();
  const connections = new Map<string, StorageConnectionRow>();
  const auditEvents: AuditEventRow[] = [];
  const folders = new Map<string, FolderRow>();
  const files = new Map<string, FileRow>();
  const fileChunks = new Map<string, FileChunkRow>();
  const uploadSessions = new Map<string, UploadSessionRow>();

  const findConnection = (where: { userId?: string; id?: string }) => {
    for (const row of connections.values()) {
      if ((where.userId && row.userId === where.userId) || (where.id && row.id === where.id)) {
        return row;
      }
    }
    return null;
  };

  const chunksOf = (fileId: string) =>
    [...fileChunks.values()]
      .filter((chunk) => chunk.fileId === fileId)
      .sort((a, b) => a.index - b.index);

  const sessionOf = (fileId: string) =>
    [...uploadSessions.values()].find((session) => session.fileId === fileId) ?? null;

  const deleteFileCascade = (fileId: string) => {
    for (const chunk of chunksOf(fileId)) {
      fileChunks.delete(chunk.id);
    }
    const session = sessionOf(fileId);
    if (session) {
      uploadSessions.delete(session.id);
    }
    files.delete(fileId);
  };

  const deleteFolderCascade = (folderId: string) => {
    for (const child of [...folders.values()].filter((f) => f.parentId === folderId)) {
      deleteFolderCascade(child.id);
    }
    for (const file of [...files.values()].filter((f) => f.folderId === folderId)) {
      deleteFileCascade(file.id);
    }
    folders.delete(folderId);
  };

  const byName = <T extends { name: string }>(rows: T[]) =>
    rows.sort((a, b) => a.name.localeCompare(b.name));

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
      findMany: async ({
        where,
        take,
        cursor,
        skip,
      }: {
        where: { userId: string };
        orderBy?: unknown;
        take?: number;
        cursor?: { id: string };
        skip?: number;
      }) => {
        // Newest first; insertion order breaks createdAt ties deterministically.
        const rows = auditEvents
          .filter((event) => event.userId === where.userId)
          .slice()
          .reverse();
        let start = 0;
        if (cursor) {
          const index = rows.findIndex((event) => event.id === cursor.id);
          start = index === -1 ? rows.length : index + (skip ?? 0);
        }
        return rows.slice(start, start + (take ?? rows.length)).map((row) => ({ ...row }));
      },
    },
    folder: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        const row = folders.get(where.id);
        return row ? { ...row } : null;
      },
      findFirst: async ({
        where,
      }: {
        where: { ownerId: string; parentId: string | null; name: string };
      }) => {
        const row = [...folders.values()].find(
          (f) =>
            f.ownerId === where.ownerId && f.parentId === where.parentId && f.name === where.name,
        );
        return row ? { ...row } : null;
      },
      findMany: async ({
        where,
      }: {
        where: { ownerId: string; parentId?: IdFilter };
        orderBy?: unknown;
        select?: unknown;
      }) => {
        const rows = [...folders.values()].filter(
          (f) => f.ownerId === where.ownerId && matchesIdFilter(f.parentId, where.parentId),
        );
        return byName(rows).map((row) => ({ ...row }));
      },
      create: async ({
        data,
      }: {
        data: { name: string; parentId: string | null; ownerId: string };
      }) => {
        const now = new Date();
        const row: FolderRow = { id: randomUUID(), createdAt: now, updatedAt: now, ...data };
        folders.set(row.id, row);
        return { ...row };
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<FolderRow> }) => {
        const row = folders.get(where.id);
        if (!row) {
          throw new Error('Record not found');
        }
        Object.assign(row, data, { updatedAt: new Date() });
        return { ...row };
      },
      delete: async ({ where }: { where: { id: string } }) => {
        const row = folders.get(where.id);
        if (!row) {
          throw new Error('Record not found');
        }
        deleteFolderCascade(where.id);
        return { ...row };
      },
      count: async ({ where }: { where: { ownerId: string } }) => {
        return [...folders.values()].filter((f) => f.ownerId === where.ownerId).length;
      },
    },
    file: {
      findUnique: async ({
        where,
        include,
      }: {
        where: { id: string };
        include?: { chunks?: unknown };
      }) => {
        const row = files.get(where.id);
        if (!row) {
          return null;
        }
        return {
          ...row,
          ...(include?.chunks ? { chunks: chunksOf(row.id).map((c) => ({ ...c })) } : {}),
        };
      },
      findMany: async ({
        where,
        take,
      }: {
        where: {
          ownerId: string;
          folderId?: IdFilter;
          name?: { contains: string; mode?: string };
        };
        orderBy?: unknown;
        take?: number;
        include?: { chunks?: unknown; folder?: unknown };
      }) => {
        const rows = [...files.values()].filter(
          (f) =>
            f.ownerId === where.ownerId &&
            matchesIdFilter(f.folderId, where.folderId) &&
            (where.name === undefined ||
              f.name.toLowerCase().includes(where.name.contains.toLowerCase())),
        );
        const sorted = byName(rows).slice(0, take ?? rows.length);
        return sorted.map((row) => ({
          ...row,
          chunks: chunksOf(row.id).map((c) => ({ ...c })),
          folder: row.folderId ? (folders.get(row.folderId) ?? null) : null,
        }));
      },
      count: async ({ where }: { where: { ownerId: string; status?: FileRow['status'] } }) => {
        return [...files.values()].filter(
          (f) => f.ownerId === where.ownerId && (!where.status || f.status === where.status),
        ).length;
      },
      aggregate: async ({ where }: { where: { ownerId: string } }) => {
        const rows = [...files.values()].filter((f) => f.ownerId === where.ownerId);
        const sum = rows.reduce((total, row) => total + row.size, 0n);
        return { _count: rows.length, _sum: { size: rows.length ? sum : null } };
      },
      create: async ({
        data,
        include,
      }: {
        data: {
          name: string;
          size: bigint;
          mimeType: string;
          status: FileRow['status'];
          totalChunks: number;
          folderId: string | null;
          ownerId: string;
          checksum?: string | null;
          chunks?: { create: { index: number; size: bigint }[] };
          uploadSession?: {
            create: {
              ownerId: string;
              partSize: number;
              chunkSize: number;
              totalParts: number;
              expiresAt: Date;
            };
          };
        };
        include?: { uploadSession?: boolean };
      }) => {
        const now = new Date();
        const row: FileRow = {
          id: randomUUID(),
          name: data.name,
          size: data.size,
          mimeType: data.mimeType,
          status: data.status,
          checksum: data.checksum ?? null,
          totalChunks: data.totalChunks,
          folderId: data.folderId,
          ownerId: data.ownerId,
          createdAt: now,
          updatedAt: now,
        };
        files.set(row.id, row);
        for (const chunk of data.chunks?.create ?? []) {
          const chunkRow: FileChunkRow = {
            id: randomUUID(),
            fileId: row.id,
            index: chunk.index,
            size: chunk.size,
            checksum: null,
            telegramMessageId: null,
            status: 'PENDING',
            attempts: 0,
            progress: 0,
          };
          fileChunks.set(chunkRow.id, chunkRow);
        }
        let session: UploadSessionRow | null = null;
        if (data.uploadSession?.create) {
          session = {
            id: randomUUID(),
            fileId: row.id,
            nextPart: 0,
            createdAt: now,
            updatedAt: now,
            ...data.uploadSession.create,
          };
          uploadSessions.set(session.id, session);
        }
        return {
          ...row,
          ...(include?.uploadSession ? { uploadSession: session ? { ...session } : null } : {}),
        };
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<FileRow> }) => {
        const row = files.get(where.id);
        if (!row) {
          throw new Error('Record not found');
        }
        Object.assign(row, data, { updatedAt: new Date() });
        return { ...row };
      },
      delete: async ({ where }: { where: { id: string } }) => {
        const row = files.get(where.id);
        if (!row) {
          throw new Error('Record not found');
        }
        deleteFileCascade(where.id);
        return { ...row };
      },
    },
    fileChunk: {
      findUnique: async ({
        where,
        include,
      }: {
        where: { fileId_index: { fileId: string; index: number } };
        include?: { file?: boolean };
      }) => {
        const row = chunksOf(where.fileId_index.fileId).find(
          (c) => c.index === where.fileId_index.index,
        );
        if (!row) {
          return null;
        }
        const file = files.get(row.fileId);
        return { ...row, ...(include?.file ? { file: file ? { ...file } : null } : {}) };
      },
      findMany: async ({
        where,
      }: {
        where: { fileId: string };
        orderBy?: unknown;
        select?: unknown;
      }) => {
        return chunksOf(where.fileId).map((c) => ({ ...c }));
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Omit<Partial<FileChunkRow>, 'attempts'> & {
          attempts?: number | { increment: number };
        };
      }) => {
        const row = fileChunks.get(where.id);
        if (!row) {
          throw new Error('Record not found');
        }
        const { attempts, ...rest } = data;
        Object.assign(row, rest);
        if (typeof attempts === 'number') {
          row.attempts = attempts;
        } else if (attempts && typeof attempts === 'object') {
          row.attempts += attempts.increment;
        }
        return { ...row };
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { fileId: string; index?: number };
        data: Partial<FileChunkRow>;
      }) => {
        let count = 0;
        for (const row of chunksOf(where.fileId)) {
          if (where.index === undefined || row.index === where.index) {
            Object.assign(row, data);
            count += 1;
          }
        }
        return { count };
      },
      count: async ({
        where,
      }: {
        where: { fileId: string; status?: { not: FileChunkRow['status'] } };
      }) => {
        return chunksOf(where.fileId).filter(
          (c) => where.status === undefined || c.status !== where.status.not,
        ).length;
      },
    },
    uploadSession: {
      findUnique: async ({
        where,
        include,
      }: {
        where: { id: string };
        include?: { file?: boolean | { include?: { chunks?: boolean } } };
      }) => {
        const row = uploadSessions.get(where.id);
        if (!row) {
          return null;
        }
        if (!include?.file) {
          return { ...row };
        }
        const file = files.get(row.fileId);
        const withChunks =
          typeof include.file === 'object' && include.file.include?.chunks
            ? { chunks: chunksOf(row.fileId).map((c) => ({ ...c })) }
            : {};
        return { ...row, file: file ? { ...file, ...withChunks } : null };
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Partial<UploadSessionRow>;
      }) => {
        const row = uploadSessions.get(where.id);
        if (!row) {
          throw new Error('Record not found');
        }
        Object.assign(row, data, { updatedAt: new Date() });
        return { ...row };
      },
      delete: async ({ where }: { where: { id: string } }) => {
        const row = uploadSessions.get(where.id);
        if (!row) {
          throw new Error('Record not found');
        }
        uploadSessions.delete(where.id);
        return { ...row };
      },
    },
    /** Test-only inspection helpers. */
    _state: {
      users,
      refreshTokens,
      connections,
      auditEvents,
      folders,
      files,
      fileChunks,
      uploadSessions,
    },
  };

  return fake as unknown as PrismaClient & { _state: typeof fake._state };
}
