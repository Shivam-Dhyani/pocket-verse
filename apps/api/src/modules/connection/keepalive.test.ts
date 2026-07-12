import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { loadMasterKeyring } from '../../lib/crypto/index.js';
import { createTestApp } from '../../test-utils/test-app.js';
import { createAuditService } from '../audit/audit.service.js';
import { createKeepAlive } from './keepalive.js';

const EMAIL = 'orbit@example.com';
const PASSWORD = 'ten-planets-minimum!';
const PHONE = '+14155552671';

const DAY_MS = 24 * 60 * 60 * 1000;

async function connectedContext() {
  const ctx = createTestApp();
  const register = await request(ctx.app)
    .post('/api/auth/register')
    .send({ email: EMAIL, password: PASSWORD });
  const token = register.body.accessToken as string;
  const userId = register.body.user.id as string;
  const auth = { Authorization: `Bearer ${token}` };
  await request(ctx.app).post('/api/connection/start').set(auth).send({ phone: PHONE });
  await request(ctx.app).post('/api/connection/verify-code').set(auth).send({ code: '12345' });

  const keepAlive = createKeepAlive({
    prisma: ctx.prisma,
    gateway: ctx.gateway,
    keyring: loadMasterKeyring(ctx.env),
    audit: createAuditService({ prisma: ctx.prisma, logger: ctx.logger }),
    logger: ctx.logger,
  });
  return { ...ctx, userId, keepAlive };
}

describe('storage connection keep-alive sweep', () => {
  it('pings connections that have gone stale and refreshes lastCheckedAt', async () => {
    const { prisma, gatewayCalls, userId, keepAlive } = await connectedContext();

    // Age the connection past the stale threshold.
    const connection = await prisma.storageConnection.findUnique({ where: { userId } });
    await prisma.storageConnection.update({
      where: { id: connection!.id },
      data: { lastCheckedAt: new Date(Date.now() - 40 * DAY_MS) },
    });
    gatewayCalls.length = 0;

    const touched = await keepAlive.sweep();

    expect(touched).toBe(1);
    expect(gatewayCalls.some((call) => call.method === 'checkHealth')).toBe(true);
    const after = await prisma.storageConnection.findUnique({ where: { userId } });
    expect(after!.status).toBe('CONNECTED');
    expect(after!.lastCheckedAt!.getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  it('leaves recently-checked connections alone', async () => {
    const { gatewayCalls, keepAlive } = await connectedContext();
    gatewayCalls.length = 0;

    const touched = await keepAlive.sweep();

    expect(touched).toBe(0);
    expect(gatewayCalls.some((call) => call.method === 'checkHealth')).toBe(false);
  });

  it('marks a dead connection as errored without crashing the sweep', async () => {
    const { prisma, userId, keepAlive } = await connectedContext();
    const connection = await prisma.storageConnection.findUnique({ where: { userId } });
    await prisma.storageConnection.update({
      where: { id: connection!.id },
      data: {
        lastCheckedAt: new Date(Date.now() - 40 * DAY_MS),
        // A session the keyring cannot decrypt behaves like a dead connection.
        encryptedSession: 'not-decryptable',
      },
    });

    await expect(keepAlive.sweep()).resolves.toBe(1);

    const after = await prisma.storageConnection.findUnique({ where: { userId } });
    expect(after!.status).toBe('ERROR');
    expect(after!.lastError).toBeTruthy();
    expect(
      prisma._state.auditEvents.some((event) => event.type === 'connection.health_failed'),
    ).toBe(true);
  });
});
