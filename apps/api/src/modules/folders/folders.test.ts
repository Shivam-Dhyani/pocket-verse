import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { createTestApp } from '../../test-utils/test-app.js';

const EMAIL = 'astro@example.com';
const PASSWORD = 'orbit-around-9-planets';
const PHONE = '+14155552671';

async function setup() {
  const ctx = createTestApp({ env: { UPLOAD_PART_SIZE_BYTES: 4, CHUNK_SIZE_BYTES: 8 } });
  const register = await request(ctx.app)
    .post('/api/auth/register')
    .send({ email: EMAIL, password: PASSWORD });
  const api = authed(ctx.app, register.body.accessToken as string);
  await api.post('/api/connection/start', { phone: PHONE });
  await api.post('/api/connection/verify-code', { code: '12345' });
  return { ...ctx, api };
}

function authed(app: Express, token: string) {
  const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);
  return {
    get: (url: string) => auth(request(app).get(url)),
    post: (url: string, body?: object) => auth(request(app).post(url)).send(body),
    patch: (url: string, body?: object) => auth(request(app).patch(url)).send(body),
    delete: (url: string) => auth(request(app).delete(url)),
    putRaw: (url: string, body: Buffer) =>
      auth(request(app).put(url)).set('Content-Type', 'application/octet-stream').send(body),
  };
}

describe('folders', () => {
  it('creates nested folders and lists them with breadcrumbs', async () => {
    const { api } = await setup();
    const docs = await api.post('/api/folders', { name: 'Docs' });
    expect(docs.status).toBe(201);
    const nested = await api.post('/api/folders', {
      name: 'Invoices',
      parentId: docs.body.folder.id,
    });

    const root = await api.get('/api/drive');
    expect(root.body.folders.map((f: { name: string }) => f.name)).toEqual(['Docs']);
    expect(root.body.breadcrumb).toEqual([]);

    const inner = await api.get(`/api/drive?folderId=${nested.body.folder.id}`);
    expect(inner.body.breadcrumb.map((b: { name: string }) => b.name)).toEqual([
      'Docs',
      'Invoices',
    ]);
  });

  it('reports the current folder’s recursive size and file count', async () => {
    const { api, queue } = await setup();
    const parent = (await api.post('/api/folders', { name: 'Parent' })).body.folder;
    const child = (await api.post('/api/folders', { name: 'Child', parentId: parent.id })).body
      .folder;

    // 8 bytes directly in Parent, 16 bytes nested in Parent/Child.
    const put = async (name: string, bytes: number, folderId: string) => {
      const content = randomBytes(bytes);
      const create = await api.post('/api/files/uploads', { name, size: bytes, folderId });
      const { uploadId, partSize, totalParts } = create.body.upload;
      for (let part = 0; part < totalParts; part += 1) {
        await api.putRaw(
          `/api/files/uploads/${uploadId}/parts/${part}`,
          content.subarray(part * partSize, (part + 1) * partSize),
        );
      }
    };
    await put('a.bin', 8, parent.id);
    await put('b.bin', 16, child.id);
    await queue.drain();

    // Root has no current folder aggregate.
    const root = await api.get('/api/drive');
    expect(root.body.currentFolder).toBeNull();

    // Parent totals both its own and the nested file (recursive).
    const inParent = await api.get(`/api/drive?folderId=${parent.id}`);
    expect(inParent.body.currentFolder).toMatchObject({
      name: 'Parent',
      totalBytes: 24,
      fileCount: 2,
    });

    // Child totals only its own file.
    const inChild = await api.get(`/api/drive?folderId=${child.id}`);
    expect(inChild.body.currentFolder).toMatchObject({ totalBytes: 16, fileCount: 1 });
  });

  it('ensure-path creates a nested tree once and reuses it on repeat', async () => {
    const { api, prisma } = await setup();

    const first = await api.post('/api/folders/ensure-path', {
      parentId: null,
      segments: ['Trip', '2026', 'Photos'],
    });
    expect(first.status).toBe(200);
    expect(prisma._state.folders.size).toBe(3);

    // Same path again: no new folders, same leaf id (get-or-create).
    const again = await api.post('/api/folders/ensure-path', {
      parentId: null,
      segments: ['Trip', '2026', 'Photos'],
    });
    expect(prisma._state.folders.size).toBe(3);
    expect(again.body.folderId).toBe(first.body.folderId);

    // A sibling branch reuses the shared prefix (Trip/2026) and adds one folder.
    await api.post('/api/folders/ensure-path', {
      parentId: null,
      segments: ['Trip', '2026', 'Videos'],
    });
    expect(prisma._state.folders.size).toBe(4);

    // The recreated tree is navigable and correctly nested.
    const root = await api.get('/api/drive');
    expect(root.body.folders.map((f: { name: string }) => f.name)).toEqual(['Trip']);
  });

  it('rejects duplicate names in the same parent', async () => {
    const { api } = await setup();
    await api.post('/api/folders', { name: 'Docs' });
    const dup = await api.post('/api/folders', { name: 'Docs' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('DUPLICATE_NAME');
  });

  it('renames and moves folders, refusing cycles', async () => {
    const { api } = await setup();
    const a = (await api.post('/api/folders', { name: 'A' })).body.folder;
    const b = (await api.post('/api/folders', { name: 'B', parentId: a.id })).body.folder;

    const renamed = await api.patch(`/api/folders/${a.id}`, { name: 'A2' });
    expect(renamed.body.folder.name).toBe('A2');

    // A2 → inside its own child B: forbidden.
    const cycle = await api.patch(`/api/folders/${a.id}`, { parentId: b.id });
    expect(cycle.status).toBe(400);
    expect(cycle.body.error.code).toBe('FOLDER_CYCLE');

    // B → root: fine.
    const moved = await api.patch(`/api/folders/${b.id}`, { parentId: null });
    expect(moved.body.folder.parentId).toBeNull();
  });

  it('recursively deletes a folder tree including stored file messages', async () => {
    const { api, queue, channelStore, prisma } = await setup();
    const a = (await api.post('/api/folders', { name: 'A' })).body.folder;
    const b = (await api.post('/api/folders', { name: 'B', parentId: a.id })).body.folder;

    // One file in the nested folder.
    const content = randomBytes(8);
    const create = await api.post('/api/files/uploads', {
      name: 'inside.bin',
      size: content.length,
      folderId: b.id,
    });
    const { uploadId, partSize, totalParts } = create.body.upload;
    for (let part = 0; part < totalParts; part += 1) {
      await api.putRaw(
        `/api/files/uploads/${uploadId}/parts/${part}`,
        content.subarray(part * partSize, (part + 1) * partSize),
      );
    }
    await queue.drain();
    expect(channelStore.size).toBe(1);

    const del = await api.delete(`/api/folders/${a.id}`);
    expect(del.status).toBe(204);
    await queue.drain();

    expect(channelStore.size).toBe(0);
    expect(prisma._state.folders.size).toBe(0);
    expect(prisma._state.files.size).toBe(0);
    expect(prisma._state.auditEvents.some((event) => event.type === 'folder.deleted')).toBe(true);
  });

  it('hides other users’ folders', async () => {
    const ctx = await setup();
    const mine = (await ctx.api.post('/api/folders', { name: 'Private' })).body.folder;

    const stranger = await request(ctx.app)
      .post('/api/auth/register')
      .send({ email: 'other@example.com', password: PASSWORD });
    const strangerApi = authed(ctx.app, stranger.body.accessToken);

    expect((await strangerApi.get(`/api/drive?folderId=${mine.id}`)).status).toBe(404);
    expect((await strangerApi.delete(`/api/folders/${mine.id}`)).status).toBe(404);
  });
});
