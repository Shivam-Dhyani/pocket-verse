import { randomBytes, createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { AppError } from '../../middleware/errors.js';
import { createTestApp, type TestAppOptions } from '../../test-utils/test-app.js';

const EMAIL = 'astro@example.com';
const PASSWORD = 'orbit-around-9-planets';
const PHONE = '+14155552671';

/** Tiny sizes so multi-part + multi-chunk paths are exercised cheaply. */
const SMALL_SIZES: TestAppOptions['env'] = {
  UPLOAD_PART_SIZE_BYTES: 4,
  CHUNK_SIZE_BYTES: 8,
};

async function setupConnected(options: TestAppOptions = {}) {
  const ctx = createTestApp({ env: SMALL_SIZES, ...options });
  const register = await request(ctx.app)
    .post('/api/auth/register')
    .send({ email: EMAIL, password: PASSWORD });
  const token = register.body.accessToken as string;
  const api = authed(ctx.app, token);
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

async function uploadWhole(
  api: ReturnType<typeof authed>,
  content: Buffer,
  name = 'hello.bin',
  folderId?: string,
) {
  const create = await api.post('/api/files/uploads', {
    name,
    size: content.length,
    mimeType: 'application/octet-stream',
    ...(folderId ? { folderId } : {}),
  });
  expect(create.status).toBe(201);
  const { uploadId, partSize, totalParts, fileId } = create.body.upload;

  for (let part = 0; part < totalParts; part += 1) {
    const slice = content.subarray(part * partSize, (part + 1) * partSize);
    const res = await api.putRaw(`/api/files/uploads/${uploadId}/parts/${part}`, slice);
    expect(res.status, `part ${part}: ${JSON.stringify(res.body)}`).toBe(200);
  }
  return { uploadId, fileId: fileId as string, totalParts, partSize };
}

describe('upload → storage → download roundtrip', () => {
  it('stores a multi-part multi-chunk file and downloads identical bytes', async () => {
    const { api, queue, channelStore } = await setupConnected();
    const content = randomBytes(20); // 5 parts of 4 bytes → 3 chunks (8+8+4)

    const { fileId } = await uploadWhole(api, content);
    await queue.drain();

    // Chunks landed in the "channel" with the right sizes.
    const stored = [...channelStore.values()].map((buffer) => buffer.length).sort((a, b) => b - a);
    expect(stored).toEqual([8, 8, 4]);

    // Listing shows the file ready with a checksum recorded.
    const drive = await api.get('/api/drive');
    expect(drive.body.files).toHaveLength(1);
    expect(drive.body.files[0]).toMatchObject({ id: fileId, status: 'ready', size: 20 });
    expect(drive.body.files[0].checksum).toMatch(/^composite:[0-9a-f]{64}$/);

    // Bytes come back identical, with honest headers.
    const download = await api.get(`/api/files/${fileId}/download`).buffer(true);
    expect(download.status).toBe(200);
    expect(download.headers['content-length']).toBe('20');
    expect(download.headers['content-disposition']).toContain('hello.bin');
    expect(Buffer.compare(download.body as Buffer, content)).toBe(0);
  });

  it('records a plain sha256 checksum for single-chunk files', async () => {
    const { api, queue } = await setupConnected();
    const content = randomBytes(6); // fits one chunk

    const { fileId } = await uploadWhole(api, content, 'small.bin');
    await queue.drain();

    const file = await api.get(`/api/files/${fileId}`);
    expect(file.body.file.checksum).toBe(createHash('sha256').update(content).digest('hex'));
  });

  it('requires a connected storage account to start an upload', async () => {
    const ctx = createTestApp({ env: SMALL_SIZES });
    const register = await request(ctx.app)
      .post('/api/auth/register')
      .send({ email: EMAIL, password: PASSWORD });
    const api = authed(ctx.app, register.body.accessToken);

    const res = await api.post('/api/files/uploads', { name: 'x.bin', size: 10 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('NOT_CONNECTED');
  });

  it('rejects unauthenticated access on every route', async () => {
    const { app } = createTestApp();
    expect((await request(app).get('/api/drive')).status).toBe(401);
    expect((await request(app).post('/api/files/uploads').send({})).status).toBe(401);
    expect((await request(app).post('/api/folders').send({})).status).toBe(401);
  });
});

describe('resumable upload protocol', () => {
  it('rejects out-of-order parts and reports the resume point', async () => {
    const { api } = await setupConnected();
    const create = await api.post('/api/files/uploads', { name: 'x.bin', size: 12 });
    const { uploadId } = create.body.upload;

    await api.putRaw(`/api/files/uploads/${uploadId}/parts/0`, Buffer.alloc(4));
    const wrong = await api.putRaw(`/api/files/uploads/${uploadId}/parts/2`, Buffer.alloc(4));
    expect(wrong.status).toBe(409);
    expect(wrong.body.error.code).toBe('PART_OUT_OF_ORDER');
    expect(wrong.body.error.nextPart).toBe(1);

    // GET reports resume state for a reconnecting client.
    const status = await api.get(`/api/files/uploads/${uploadId}`);
    expect(status.body.upload.nextPart).toBe(1);
  });

  it('rejects a part with the wrong byte count', async () => {
    const { api } = await setupConnected();
    const create = await api.post('/api/files/uploads', { name: 'x.bin', size: 12 });
    const { uploadId } = create.body.upload;

    const res = await api.putRaw(`/api/files/uploads/${uploadId}/parts/0`, Buffer.alloc(3));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('PART_SIZE_MISMATCH');

    // The failed part rolled back — part 0 can be retried cleanly.
    const retry = await api.putRaw(`/api/files/uploads/${uploadId}/parts/0`, Buffer.alloc(4));
    expect(retry.status).toBe(200);
  });

  it('aborting an upload removes metadata, staging, and uploaded messages', async () => {
    const { api, queue, channelStore, env } = await setupConnected();
    const create = await api.post('/api/files/uploads', { name: 'x.bin', size: 12 });
    const { uploadId, fileId } = create.body.upload;

    // Two parts = first chunk complete and shipped.
    await api.putRaw(`/api/files/uploads/${uploadId}/parts/0`, Buffer.alloc(4, 1));
    await api.putRaw(`/api/files/uploads/${uploadId}/parts/1`, Buffer.alloc(4, 2));
    await queue.drain();
    expect(channelStore.size).toBe(1);

    const abort = await api.delete(`/api/files/uploads/${uploadId}`);
    expect(abort.status).toBe(204);
    await queue.drain();

    expect(channelStore.size).toBe(0);
    expect(existsSync(`${env.STAGING_DIR}/${fileId}`)).toBe(false);
    const drive = await api.get('/api/drive');
    expect(drive.body.files).toHaveLength(0);
  });

  it('retries failed chunk uploads and eventually succeeds', async () => {
    let failures = 0;
    const { api, queue } = await setupConnected({
      gateway: {
        beforeUpload: async () => {
          failures += 1;
          if (failures <= 2) {
            throw new AppError(429, 'FLOOD_WAIT', 'slow down', { retryAfterSeconds: 60 });
          }
        },
      },
    });

    const { fileId } = await uploadWhole(api, randomBytes(6), 'retry.bin');
    await queue.drain();

    const file = await api.get(`/api/files/${fileId}`);
    expect(file.body.file.status).toBe('ready');
    expect(failures).toBe(3);
  });

  it('marks the file failed after retries are exhausted', async () => {
    const { api, queue, prisma } = await setupConnected({
      gateway: {
        beforeUpload: async () => {
          throw new AppError(502, 'STORAGE_UNAVAILABLE', 'nope');
        },
      },
    });

    const { fileId } = await uploadWhole(api, randomBytes(6), 'doomed.bin');
    await queue.drain();

    const file = await api.get(`/api/files/${fileId}`);
    expect(file.body.file.status).toBe('error');
    expect(prisma._state.auditEvents.some((event) => event.type === 'file.upload_failed')).toBe(
      true,
    );
  });
});

describe('file management', () => {
  it('renames and moves a file', async () => {
    const { api, queue } = await setupConnected();
    const folder = await api.post('/api/folders', { name: 'Docs' });
    const { fileId } = await uploadWhole(api, randomBytes(6));
    await queue.drain();

    const renamed = await api.patch(`/api/files/${fileId}`, { name: 'renamed.bin' });
    expect(renamed.body.file.name).toBe('renamed.bin');

    const moved = await api.patch(`/api/files/${fileId}`, { folderId: folder.body.folder.id });
    expect(moved.body.file.folderId).toBe(folder.body.folder.id);

    const inFolder = await api.get(`/api/drive?folderId=${folder.body.folder.id}`);
    expect(inFolder.body.files).toHaveLength(1);
    expect(inFolder.body.breadcrumb).toEqual([{ id: folder.body.folder.id, name: 'Docs' }]);
  });

  it('deleting a file deletes its storage messages too', async () => {
    const { api, queue, channelStore, prisma } = await setupConnected();
    const { fileId } = await uploadWhole(api, randomBytes(20));
    await queue.drain();
    expect(channelStore.size).toBe(3);

    const res = await api.delete(`/api/files/${fileId}`);
    expect(res.status).toBe(204);
    await queue.drain();

    expect(channelStore.size).toBe(0);
    expect(prisma._state.auditEvents.some((event) => event.type === 'file.deleted')).toBe(true);
  });

  it('never returns another user’s file', async () => {
    const ctx = await setupConnected();
    const { fileId } = await uploadWhole(ctx.api, randomBytes(6));
    await ctx.queue.drain();

    const stranger = await request(ctx.app)
      .post('/api/auth/register')
      .send({ email: 'other@example.com', password: PASSWORD });
    const strangerApi = authed(ctx.app, stranger.body.accessToken);
    expect((await strangerApi.get(`/api/files/${fileId}`)).status).toBe(404);
    expect((await strangerApi.get(`/api/files/${fileId}/download`)).status).toBe(404);
    expect((await strangerApi.delete(`/api/files/${fileId}`)).status).toBe(404);
  });

  it('refuses to download a file that is not ready', async () => {
    const { api } = await setupConnected();
    const create = await api.post('/api/files/uploads', { name: 'x.bin', size: 12 });
    const res = await api.get(`/api/files/${create.body.upload.fileId}/download`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('FILE_NOT_READY');
  });

  it('validates upload input (name, size)', async () => {
    const { api } = await setupConnected();
    expect((await api.post('/api/files/uploads', { name: 'a/b.bin', size: 10 })).status).toBe(400);
    expect((await api.post('/api/files/uploads', { name: 'ok.bin', size: 0 })).status).toBe(400);
  });
});
