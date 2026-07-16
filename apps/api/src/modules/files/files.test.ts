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

  it('marks a file lost and logs it when its data was deleted in the channel', async () => {
    const { api, queue, channelStore, prisma } = await setupConnected();
    const content = randomBytes(6);
    const { fileId } = await uploadWhole(api, content, 'gone.bin');
    await queue.drain();

    // Simulate the user hand-deleting the message from their storage channel.
    channelStore.clear();

    // The download fails (stream may abort mid-response — status is best-effort).
    await api
      .get(`/api/files/${fileId}/download`)
      .buffer(true)
      .catch(() => null);

    // The file is marked as no longer retrievable…
    const file = await api.get(`/api/files/${fileId}`);
    expect(file.body.file.status).toBe('error');

    // …and the loss is written to the user's activity log with what was lost.
    const lost = prisma._state.auditEvents.find((event) => event.type === 'file.unreachable');
    expect(lost?.metadata).toMatchObject({ fileId, name: 'gone.bin', size: 6 });
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

  it('reports partial sync progress while chunks are still shipping', async () => {
    const { api, queue } = await setupConnected();
    // 16 bytes = 2 chunks of 8; upload only the first chunk's parts.
    const content = randomBytes(16);
    const create = await api.post('/api/files/uploads', { name: 'half.bin', size: 16 });
    const { uploadId, partSize } = create.body.upload;
    await api.putRaw(`/api/files/uploads/${uploadId}/parts/0`, content.subarray(0, partSize));
    await api.putRaw(
      `/api/files/uploads/${uploadId}/parts/1`,
      content.subarray(partSize, partSize * 2),
    );
    await queue.drain(); // chunk 0 stored; chunk 1 not even staged yet

    const file = await api.get(`/api/files/${create.body.upload.fileId}`);
    expect(file.body.file.status).toBe('uploading');
    expect(file.body.file.syncProgress).toBe(50);

    const drive = await api.get('/api/drive');
    expect(drive.body.files[0].syncProgress).toBe(50);
  });

  it('issues a download token that authorizes a plain (headerless) download', async () => {
    const { app, api, queue } = await setupConnected();
    const content = randomBytes(6);
    const { fileId } = await uploadWhole(api, content, 'linked.bin');
    await queue.drain();

    const minted = await api.post(`/api/files/${fileId}/download-token`);
    expect(minted.status).toBe(200);
    const token = minted.body.token as string;

    // No Authorization header — exactly how a browser navigation arrives.
    const download = await request(app)
      .get(`/api/files/${fileId}/download?token=${encodeURIComponent(token)}`)
      .buffer(true);
    expect(download.status).toBe(200);
    expect(Buffer.compare(download.body as Buffer, content)).toBe(0);
  });

  it('rejects a download token used on a different file', async () => {
    const { app, api, queue } = await setupConnected();
    const first = await uploadWhole(api, randomBytes(6), 'one.bin');
    const second = await uploadWhole(api, randomBytes(6), 'two.bin');
    await queue.drain();

    const minted = await api.post(`/api/files/${first.fileId}/download-token`);
    const res = await request(app).get(
      `/api/files/${second.fileId}/download?token=${encodeURIComponent(minted.body.token)}`,
    );
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('DOWNLOAD_LINK_EXPIRED');
  });

  it('rejects garbage download tokens and refuses to mint for foreign files', async () => {
    const { app, api, queue } = await setupConnected();
    const { fileId } = await uploadWhole(api, randomBytes(6));
    await queue.drain();

    expect((await request(app).get(`/api/files/${fileId}/download?token=nonsense`)).status).toBe(
      401,
    );

    const stranger = await request(app)
      .post('/api/auth/register')
      .send({ email: 'other@example.com', password: PASSWORD });
    const strangerApi = authed(app, stranger.body.accessToken);
    expect((await strangerApi.post(`/api/files/${fileId}/download-token`)).status).toBe(404);
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

describe('cancel and retry robustness', () => {
  it('removes the just-posted channel message when the file was deleted mid-transfer', async () => {
    // Removing the DB rows while the chunk bytes are in flight to the channel
    // simulates a cancel landing at the worst possible moment: too late to
    // stop the post, too early for the message id to be recorded anywhere.
    let deleteRowsMidFlight: (() => Promise<void>) | null = null;
    const ctx = await setupConnected({
      gateway: {
        beforeUpload: async () => {
          await deleteRowsMidFlight?.();
          deleteRowsMidFlight = null;
        },
      },
    });

    const content = randomBytes(6);
    const create = await ctx.api.post('/api/files/uploads', { name: 'ghost.bin', size: 6 });
    const { uploadId, partSize } = create.body.upload;
    const fileId = create.body.upload.fileId as string;
    deleteRowsMidFlight = async () => {
      await ctx.prisma.file.delete({ where: { id: fileId } });
    };
    await ctx.api.putRaw(`/api/files/uploads/${uploadId}/parts/0`, content.subarray(0, partSize));
    await ctx.api.putRaw(`/api/files/uploads/${uploadId}/parts/1`, content.subarray(partSize));
    await ctx.queue.drain();

    // The posted message was detected as orphaned and removed from the channel.
    expect(ctx.gatewayCalls.some((call) => call.method === 'deleteMessages')).toBe(true);
    expect(ctx.channelStore.size).toBe(0);
  });

  it('retries failed syncs from kept staging after the connection recovers', async () => {
    let failing = true;
    const { api, queue } = await setupConnected({
      gateway: {
        beforeUpload: async () => {
          if (failing) {
            throw new AppError(502, 'STORAGE_UNAVAILABLE', 'nope');
          }
        },
      },
    });

    const { fileId } = await uploadWhole(api, randomBytes(6), 'later.bin');
    await queue.drain();
    expect((await api.get(`/api/files/${fileId}`)).body.file.status).toBe('error');

    // Connection is healthy again — retry re-enqueues from the kept staging.
    failing = false;
    const retry = await api.post('/api/files/retry-failed');
    expect(retry.status).toBe(200);
    expect(retry.body).toMatchObject({ retried: 1, unrecoverable: 0 });
    await queue.drain();

    expect((await api.get(`/api/files/${fileId}`)).body.file.status).toBe('ready');
  });

  it('reports files as unrecoverable when their staged bytes are gone', async () => {
    const { api, queue, env } = await setupConnected({
      gateway: {
        beforeUpload: async () => {
          throw new AppError(502, 'STORAGE_UNAVAILABLE', 'nope');
        },
      },
    });
    const { fileId } = await uploadWhole(api, randomBytes(6), 'wiped.bin');
    await queue.drain();

    // Simulate a deploy wiping the staging disk.
    const { rm } = await import('node:fs/promises');
    const path = await import('node:path');
    await rm(path.join(env.STAGING_DIR, fileId), { recursive: true, force: true });

    const retry = await api.post('/api/files/retry-failed');
    expect(retry.body).toMatchObject({ retried: 0, unrecoverable: 1 });
    expect((await api.get(`/api/files/${fileId}`)).body.file.status).toBe('error');
  });
});

describe('zip downloads and connection reuse', () => {
  it('downloads a mixed selection as one zip with folder structure preserved', async () => {
    const { api, queue, app } = await setupConnected();
    const folder = await api.post('/api/folders', { name: 'Docs' });
    const folderId = folder.body.folder.id as string;
    await uploadWhole(api, randomBytes(6), 'loose.bin');
    await uploadWhole(api, randomBytes(6), 'inside.bin', folderId);
    await queue.drain();

    const drive = await api.get('/api/drive');
    const looseId = drive.body.files[0].id as string;

    const minted = await api.post('/api/files/zip-token', {
      fileIds: [looseId],
      folderIds: [folderId],
    });
    expect(minted.status).toBe(200);
    expect(minted.body.files).toBe(2);

    const res = await request(app)
      .get(`/api/files/zip?token=${encodeURIComponent(minted.body.token)}`)
      .buffer(true)
      .parse((r, cb) => {
        const parts: Buffer[] = [];
        r.on('data', (d: Buffer) => parts.push(d));
        r.on('end', () => cb(null, Buffer.concat(parts)));
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/zip');
    const body = res.body as Buffer;
    expect(body.subarray(0, 2).toString()).toBe('PK'); // zip magic
    const listing = body.toString('latin1');
    expect(listing).toContain('loose.bin');
    expect(listing).toContain('Docs/inside.bin'); // structure preserved
  });

  it('refuses a selection containing files the user does not own', async () => {
    const ctx = await setupConnected();
    const { fileId } = await uploadWhole(ctx.api, randomBytes(6), 'mine.bin');
    await ctx.queue.drain();

    const stranger = await request(ctx.app)
      .post('/api/auth/register')
      .send({ email: 'thief@example.com', password: 'ten-characters-long' });
    const res = await request(ctx.app)
      .post('/api/files/zip-token')
      .set('Authorization', `Bearer ${stranger.body.accessToken}`)
      .send({ fileIds: [fileId] });
    expect(res.status).toBe(400); // stranger has no connection → NOT_CONNECTED
  });

  it('rejects selections beyond the zip size cap with an honest error', async () => {
    const { api, queue } = await setupConnected({
      env: { ...SMALL_SIZES, ZIP_MAX_BYTES: 10 },
    });
    const { fileId } = await uploadWhole(api, randomBytes(20), 'big.bin');
    await queue.drain();

    const res = await api.post('/api/files/zip-token', { fileIds: [fileId] });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('ZIP_TOO_LARGE');
  });

  it('reuses ONE connection for all chunks of a download and closes it', async () => {
    const { api, queue, gatewayCalls } = await setupConnected();
    const content = randomBytes(20); // 3 chunks with the tiny test sizes
    const { fileId } = await uploadWhole(api, content);
    await queue.drain();
    gatewayCalls.length = 0;

    const download = await api.get(`/api/files/${fileId}/download`).buffer(true);
    expect(download.status).toBe(200);

    const opens = gatewayCalls.filter((c) => c.method === 'createDownloader').length;
    const chunks = gatewayCalls.filter((c) => c.method === 'downloadChunk').length;
    const closes = gatewayCalls.filter((c) => c.method === 'downloaderClose').length;
    expect(chunks).toBe(3);
    expect(opens).toBe(1); // one connection for the whole file
    expect(closes).toBe(1); // and it was released
  });
});
