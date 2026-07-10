import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { decryptWithDataKey, loadMasterKeyring } from '../../lib/crypto/index.js';
import { AppError } from '../../middleware/errors.js';
import {
  FAKE_CHANNEL,
  FAKE_FINAL_SESSION,
  FAKE_TEMP_SESSION,
} from '../../test-utils/fake-gateway.js';
import { createTestApp, TEST_ENV } from '../../test-utils/test-app.js';
import { maskPhone } from './connection.service.js';

const PHONE = '+14155552671';
const EMAIL = 'astro@example.com';
const PASSWORD = 'orbit-around-9-planets';

async function registerUser(app: Express): Promise<string> {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ email: EMAIL, password: PASSWORD });
  expect(res.status).toBe(201);
  return res.body.accessToken as string;
}

function authed(app: Express, token: string) {
  return {
    get: (url: string) => request(app).get(url).set('Authorization', `Bearer ${token}`),
    post: (url: string, body?: object) =>
      request(app).post(url).set('Authorization', `Bearer ${token}`).send(body),
    delete: (url: string) => request(app).delete(url).set('Authorization', `Bearer ${token}`),
    putRaw: (url: string, body: Buffer) =>
      request(app)
        .put(url)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/octet-stream')
        .send(body),
  };
}

describe('connection flow', () => {
  it('requires authentication on every endpoint', async () => {
    const { app } = createTestApp();
    expect((await request(app).get('/api/connection')).status).toBe(401);
    expect((await request(app).post('/api/connection/start').send({ phone: PHONE })).status).toBe(
      401,
    );
    expect((await request(app).delete('/api/connection')).status).toBe(401);
  });

  it('reports status none before any connection', async () => {
    const { app } = createTestApp();
    const api = authed(app, await registerUser(app));
    const res = await api.get('/api/connection');
    expect(res.status).toBe(200);
    expect(res.body.connection).toEqual({
      status: 'none',
      phoneMasked: null,
      channelReady: false,
      lastCheckedAt: null,
      lastError: null,
    });
  });

  it('completes phone → code → connected (no 2FA)', async () => {
    const { app, prisma, gatewayCalls } = createTestApp();
    const api = authed(app, await registerUser(app));

    const start = await api.post('/api/connection/start', { phone: PHONE });
    expect(start.status).toBe(200);
    expect(start.body.connection.status).toBe('pending_code');
    expect(start.body.connection.phoneMasked).toBe(maskPhone(PHONE));

    const verify = await api.post('/api/connection/verify-code', { code: '12345' });
    expect(verify.status).toBe(200);
    expect(verify.body.connection.status).toBe('connected');
    expect(verify.body.connection.channelReady).toBe(true);
    expect(verify.body.connection.lastCheckedAt).not.toBeNull();

    // The gateway received the pending state we stored, decrypted correctly.
    const signInCall = gatewayCalls.find((c) => c.method === 'signInWithCode');
    expect(signInCall?.args).toMatchObject({
      tempSession: FAKE_TEMP_SESSION,
      phone: PHONE,
      code: '12345',
    });

    // Channel info persisted; pending blob cleared.
    const [row] = [...prisma._state.connections.values()];
    expect(row?.channelId).toBe(FAKE_CHANNEL.channelId);
    expect(row?.encryptedPending).toBeNull();
  });

  it('routes through the 2FA password step when required', async () => {
    const { app } = createTestApp({ requirePassword: true });
    const api = authed(app, await registerUser(app));

    await api.post('/api/connection/start', { phone: PHONE });
    const code = await api.post('/api/connection/verify-code', { code: '12345' });
    expect(code.body.connection.status).toBe('pending_password');

    const password = await api.post('/api/connection/verify-password', {
      password: 'my-2fa-password',
    });
    expect(password.status).toBe(200);
    expect(password.body.connection.status).toBe('connected');
  });

  it('stores the session encrypted — and it decrypts back to the real session', async () => {
    const { app, prisma } = createTestApp();
    const api = authed(app, await registerUser(app));

    await api.post('/api/connection/start', { phone: PHONE });
    await api.post('/api/connection/verify-code', { code: '12345' });

    const [row] = [...prisma._state.connections.values()];
    expect(row).toBeDefined();
    expect(row!.encryptedSession).not.toContain(FAKE_FINAL_SESSION);
    expect(row!.encryptedSession).toMatch(/^v1\./);

    const keyring = loadMasterKeyring(TEST_ENV);
    const decrypted = decryptWithDataKey(
      row!.encryptedSession!,
      row!.wrappedDataKey,
      keyring,
      `user:${row!.userId}:connection`,
    );
    expect(decrypted.toString('utf8')).toBe(FAKE_FINAL_SESSION);
  });

  it('never exposes session material or key data through the API', async () => {
    const { app } = createTestApp();
    const api = authed(app, await registerUser(app));

    await api.post('/api/connection/start', { phone: PHONE });
    const res = await api.post('/api/connection/verify-code', { code: '12345' });

    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain(FAKE_FINAL_SESSION);
    expect(serialized).not.toContain(FAKE_TEMP_SESSION);
    expect(serialized).not.toContain('wrappedDataKey');
    expect(serialized).not.toContain('encryptedSession');
    expect(serialized).not.toContain(PHONE); // only the masked form leaves the API
  });

  it('maps a wrong code to a friendly 400', async () => {
    const { app } = createTestApp({
      signInWithCode: async () => {
        throw new AppError(
          400,
          'CODE_INVALID',
          'That code is not correct. Check it and try again.',
        );
      },
    });
    const api = authed(app, await registerUser(app));

    await api.post('/api/connection/start', { phone: PHONE });
    const res = await api.post('/api/connection/verify-code', { code: '99999' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('CODE_INVALID');
  });

  it('surfaces long FLOOD_WAITs as 429 with retryAfterSeconds', async () => {
    const { app } = createTestApp({
      sendCode: async () => {
        throw new AppError(
          429,
          'FLOOD_WAIT',
          'The storage provider asked us to slow down. Try again in about 5 minutes.',
          { retryAfterSeconds: 300 },
        );
      },
    });
    const api = authed(app, await registerUser(app));

    const res = await api.post('/api/connection/start', { phone: PHONE });
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('FLOOD_WAIT');
    expect(res.body.error.retryAfterSeconds).toBe(300);
  });

  it('rejects verify-code without a pending attempt', async () => {
    const { app } = createTestApp();
    const api = authed(app, await registerUser(app));
    const res = await api.post('/api/connection/verify-code', { code: '12345' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('NO_PENDING_CONNECTION');
  });

  it('rejects an expired pending attempt', async () => {
    const { app, prisma } = createTestApp();
    const api = authed(app, await registerUser(app));

    await api.post('/api/connection/start', { phone: PHONE });
    const [row] = [...prisma._state.connections.values()];
    row!.pendingExpiresAt = new Date(Date.now() - 1000);

    const res = await api.post('/api/connection/verify-code', { code: '12345' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('PENDING_EXPIRED');
  });

  it('refuses to start over an already-connected account', async () => {
    const { app } = createTestApp();
    const api = authed(app, await registerUser(app));

    await api.post('/api/connection/start', { phone: PHONE });
    await api.post('/api/connection/verify-code', { code: '12345' });

    const res = await api.post('/api/connection/start', { phone: PHONE });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ALREADY_CONNECTED');
  });

  it('allows restarting a pending (not yet connected) attempt', async () => {
    const { app } = createTestApp();
    const api = authed(app, await registerUser(app));

    await api.post('/api/connection/start', { phone: PHONE });
    const res = await api.post('/api/connection/start', { phone: '+14155550000' });
    expect(res.status).toBe(200);
    expect(res.body.connection.status).toBe('pending_code');
    expect(res.body.connection.phoneMasked).toBe(maskPhone('+14155550000'));
  });

  it('health check succeeds and updates lastCheckedAt', async () => {
    const { app, gatewayCalls } = createTestApp();
    const api = authed(app, await registerUser(app));

    await api.post('/api/connection/start', { phone: PHONE });
    await api.post('/api/connection/verify-code', { code: '12345' });

    const res = await api.post('/api/connection/check');
    expect(res.status).toBe(200);
    expect(res.body.connection.status).toBe('connected');
    expect(res.body.connection.lastError).toBeNull();

    const health = gatewayCalls.find((c) => c.method === 'checkHealth');
    expect(health?.args).toMatchObject({ session: FAKE_FINAL_SESSION, channel: FAKE_CHANNEL });
  });

  it('health check failure flips status to error with an honest message, and recovers', async () => {
    let failing = true;
    const { app, prisma } = createTestApp({
      checkHealth: async () => {
        if (failing) {
          throw new AppError(
            401,
            'SESSION_REVOKED',
            'Access was revoked from the storage side. Reconnect your account to continue.',
          );
        }
      },
    });
    const api = authed(app, await registerUser(app));

    await api.post('/api/connection/start', { phone: PHONE });
    await api.post('/api/connection/verify-code', { code: '12345' });

    const failed = await api.post('/api/connection/check');
    expect(failed.status).toBe(200);
    expect(failed.body.connection.status).toBe('error');
    expect(failed.body.connection.lastError).toContain('Reconnect');
    expect(
      prisma._state.auditEvents.some((event) => event.type === 'connection.health_failed'),
    ).toBe(true);

    failing = false;
    const recovered = await api.post('/api/connection/check');
    expect(recovered.body.connection.status).toBe('connected');
    expect(recovered.body.connection.lastError).toBeNull();
  });

  it('disconnect logs out remotely, deletes the row, and audits', async () => {
    const { app, prisma, gatewayCalls } = createTestApp();
    const api = authed(app, await registerUser(app));

    await api.post('/api/connection/start', { phone: PHONE });
    await api.post('/api/connection/verify-code', { code: '12345' });

    const res = await api.delete('/api/connection');
    expect(res.status).toBe(204);
    expect(prisma._state.connections.size).toBe(0);
    expect(gatewayCalls.some((c) => c.method === 'logOut')).toBe(true);
    expect(
      prisma._state.auditEvents.some((event) => event.type === 'connection.disconnected'),
    ).toBe(true);

    const status = await api.get('/api/connection');
    expect(status.body.connection.status).toBe('none');
  });

  it('disconnect purges the drive so reconnecting starts clean (no ghost files)', async () => {
    const { app, prisma } = createTestApp({
      env: { UPLOAD_PART_SIZE_BYTES: 4, CHUNK_SIZE_BYTES: 8 },
    });
    const api = authed(app, await registerUser(app));
    await api.post('/api/connection/start', { phone: PHONE });
    await api.post('/api/connection/verify-code', { code: '12345' });

    // Create a folder and a file.
    const folder = await api.post('/api/folders', { name: 'Docs' });
    const create = await api.post('/api/files/uploads', {
      name: 'a.bin',
      size: 4,
      folderId: folder.body.folder.id,
    });
    await api.putRaw(
      `/api/files/uploads/${create.body.upload.uploadId}/parts/0`,
      Buffer.alloc(4, 7),
    );
    expect(prisma._state.files.size).toBe(1);
    expect(prisma._state.folders.size).toBe(1);

    await api.delete('/api/connection');

    // The metadata that pointed at the now-unreachable channel is gone.
    expect(prisma._state.files.size).toBe(0);
    expect(prisma._state.folders.size).toBe(0);
    expect(prisma._state.fileChunks.size).toBe(0);
  });

  it('disconnect still deletes locally when remote logout fails', async () => {
    const { app, prisma } = createTestApp({
      logOut: async () => {
        throw new AppError(502, 'STORAGE_UNAVAILABLE', 'unreachable');
      },
    });
    const api = authed(app, await registerUser(app));

    await api.post('/api/connection/start', { phone: PHONE });
    await api.post('/api/connection/verify-code', { code: '12345' });

    const res = await api.delete('/api/connection');
    expect(res.status).toBe(204);
    expect(prisma._state.connections.size).toBe(0);
  });

  it('records audit events for the full connect lifecycle', async () => {
    const { app, prisma } = createTestApp();
    const api = authed(app, await registerUser(app));

    await api.post('/api/connection/start', { phone: PHONE });
    await api.post('/api/connection/verify-code', { code: '12345' });

    const types = prisma._state.auditEvents.map((event) => event.type);
    expect(types).toContain('auth.register');
    expect(types).toContain('connection.started');
    expect(types).toContain('connection.connected');
    // Audit metadata must never contain the raw phone.
    expect(JSON.stringify(prisma._state.auditEvents)).not.toContain(PHONE);
  });

  it('validates the phone format', async () => {
    const { app } = createTestApp();
    const api = authed(app, await registerUser(app));
    const res = await api.post('/api/connection/start', { phone: '415-555-2671' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
  });
});

describe('maskPhone', () => {
  it('keeps prefix and last 4 digits only', () => {
    expect(maskPhone('+14155552671')).toBe('+14•••••2671');
    expect(maskPhone('+919876543210')).toBe('+91••••••3210');
  });

  it('handles short numbers without leaking digits', () => {
    expect(maskPhone('+123456')).toBe('+1•••56');
  });
});
