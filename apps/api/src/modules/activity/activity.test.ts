import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { createTestApp } from '../../test-utils/test-app.js';

const EMAIL = 'astro@example.com';
const PASSWORD = 'orbit-around-9-planets';
const PHONE = '+14155552671';

function authed(app: Express, token: string) {
  const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);
  return {
    get: (url: string) => auth(request(app).get(url)),
    post: (url: string, body?: object) => auth(request(app).post(url)).send(body),
    putRaw: (url: string, body: Buffer) =>
      auth(request(app).put(url)).set('Content-Type', 'application/octet-stream').send(body),
  };
}

async function setupConnected() {
  const ctx = createTestApp({ env: { UPLOAD_PART_SIZE_BYTES: 4, CHUNK_SIZE_BYTES: 8 } });
  const register = await request(ctx.app)
    .post('/api/auth/register')
    .send({ email: EMAIL, password: PASSWORD });
  const api = authed(ctx.app, register.body.accessToken as string);
  await api.post('/api/connection/start', { phone: PHONE });
  await api.post('/api/connection/verify-code', { code: '12345' });
  return { ...ctx, api };
}

async function upload(api: ReturnType<typeof authed>, name: string, bytes = 6, folderId?: string) {
  const content = randomBytes(bytes);
  const create = await api.post('/api/files/uploads', {
    name,
    size: bytes,
    ...(folderId ? { folderId } : {}),
  });
  const { uploadId, partSize, totalParts, fileId } = create.body.upload;
  for (let part = 0; part < totalParts; part += 1) {
    await api.putRaw(
      `/api/files/uploads/${uploadId}/parts/${part}`,
      content.subarray(part * partSize, (part + 1) * partSize),
    );
  }
  return fileId as string;
}

describe('search', () => {
  it('finds files by name fragment, case-insensitively, with folder context', async () => {
    const { api, queue } = await setupConnected();
    const folder = await api.post('/api/folders', { name: 'Reports' });
    await upload(api, 'Quarterly-Report.pdf', 6, folder.body.folder.id);
    await upload(api, 'holiday-photo.jpg');
    await queue.drain();

    const res = await api.get('/api/files/search?q=report');
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0]).toMatchObject({
      name: 'Quarterly-Report.pdf',
      folderName: 'Reports',
      status: 'ready',
    });

    const empty = await api.get('/api/files/search?q=');
    expect(empty.body.results).toEqual([]);
  });

  it('never returns another user’s files', async () => {
    const ctx = await setupConnected();
    await upload(ctx.api, 'secret-plans.txt');
    await ctx.queue.drain();

    const stranger = await request(ctx.app)
      .post('/api/auth/register')
      .send({ email: 'other@example.com', password: PASSWORD });
    const strangerApi = authed(ctx.app, stranger.body.accessToken);
    const res = await strangerApi.get('/api/files/search?q=secret');
    expect(res.body.results).toEqual([]);
  });
});

describe('activity log', () => {
  it('returns newest-first events and paginates with a cursor', async () => {
    const { api, queue } = await setupConnected();
    for (let i = 0; i < 25; i += 1) {
      await upload(api, `file-${i}.bin`);
    }
    await queue.drain();

    const first = await api.get('/api/activity');
    expect(first.status).toBe(200);
    expect(first.body.events).toHaveLength(20);
    expect(first.body.nextCursor).toBeTypeOf('string');
    // Newest first: uploads happened after connection events.
    expect(first.body.events[0].type).toBe('file.uploaded');

    const second = await api.get(`/api/activity?cursor=${first.body.nextCursor}`);
    expect(second.status).toBe(200);
    expect(second.body.events.length).toBeGreaterThan(0);
    const ids = new Set([
      ...first.body.events.map((e: { id: string }) => e.id),
      ...second.body.events.map((e: { id: string }) => e.id),
    ]);
    expect(ids.size).toBe(first.body.events.length + second.body.events.length);
  });

  it('exposes only safe fields and never other users’ events', async () => {
    const ctx = await setupConnected();
    const res = await ctx.api.get('/api/activity');
    for (const event of res.body.events) {
      expect(Object.keys(event).sort()).toEqual(['createdAt', 'id', 'metadata', 'type']);
    }
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain(PHONE); // masked only
    expect(serialized).not.toContain('session');

    const stranger = await request(ctx.app)
      .post('/api/auth/register')
      .send({ email: 'other@example.com', password: PASSWORD });
    const strangerRes = await authed(ctx.app, stranger.body.accessToken).get('/api/activity');
    // Only their own registration event — nothing from the first user.
    expect(strangerRes.body.events.every((e: { type: string }) => e.type === 'auth.register')).toBe(
      true,
    );
  });
});

describe('stats', () => {
  it('aggregates files, folders, bytes, and syncing count', async () => {
    const { api, queue } = await setupConnected();
    await api.post('/api/folders', { name: 'A' });
    await api.post('/api/folders', { name: 'B' });
    await upload(api, 'one.bin', 6);
    await upload(api, 'two.bin', 10);
    await queue.drain();

    const res = await api.get('/api/stats');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ files: 2, folders: 2, totalBytes: 16, syncingCount: 0 });
  });

  it('requires auth', async () => {
    const { app } = createTestApp();
    expect((await request(app).get('/api/stats')).status).toBe(401);
    expect((await request(app).get('/api/activity')).status).toBe(401);
  });
});

describe('inline previews', () => {
  it('serves a previewable type inline, with cross-origin embedding allowed', async () => {
    const { app, api, queue } = await setupConnected();
    const fileId = await upload(api, 'photo.jpg');
    await queue.drain();

    const minted = await api.post(`/api/files/${fileId}/download-token`);
    const res = await request(app)
      .get(
        `/api/files/${fileId}/download?token=${encodeURIComponent(minted.body.token)}&disposition=inline`,
      )
      .buffer(true);
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/^inline;/);
    // A .jpg with no client mime is inferred, so the browser renders it.
    expect(res.headers['content-type']).toContain('image/jpeg');
    // The web origin can embed it (Helmet's same-origin defaults are relaxed here).
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(res.headers['x-frame-options']).toBeUndefined();
  });

  it('forces attachment for non-previewable types even when inline is requested', async () => {
    const { app, api, queue } = await setupConnected();
    const fileId = await upload(api, 'notes.txt');
    await queue.drain();

    const minted = await api.post(`/api/files/${fileId}/download-token`);
    const res = await request(app)
      .get(
        `/api/files/${fileId}/download?token=${encodeURIComponent(minted.body.token)}&disposition=inline`,
      )
      .buffer(true);
    // A text file must never render inline in our origin — forced to attachment.
    expect(res.headers['content-disposition']).toMatch(/^attachment;/);
    expect(res.headers['cross-origin-resource-policy'] ?? 'same-origin').toBe('same-origin');
  });
});
