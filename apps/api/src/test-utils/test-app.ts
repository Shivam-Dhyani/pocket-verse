import { Writable } from 'node:stream';
import { createApp } from '../app.js';
import type { Env } from '../config/env.js';
import { createLogger } from '../lib/logger.js';
import { createFakeGateway, type FakeGatewayOptions } from './fake-gateway.js';
import { createFakePrisma } from './fake-prisma.js';

export const TEST_ENV: Env = {
  NODE_ENV: 'test',
  PORT: 0,
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
  JWT_SECRET: 'test-secret-at-least-32-characters-long!!',
  MASTER_KEYS: 'k1:P6BcyMBP0d5eDPPB0AJU0v3xkGYcYnkYnj+FI0Zt5Ao=',
  MASTER_KEY_ACTIVE: 'k1',
  CORS_ORIGIN: 'http://localhost:3000',
  TELEGRAM_API_ID: 12345,
  TELEGRAM_API_HASH: 'test-api-hash-0123456789abcdef',
};

export function createTestApp(gatewayOptions: FakeGatewayOptions = {}) {
  const prisma = createFakePrisma();
  const { gateway, calls } = createFakeGateway(gatewayOptions);
  const sink = new Writable({ write: (_c, _e, cb) => cb() });
  const app = createApp({
    env: TEST_ENV,
    prisma,
    logger: createLogger({ level: 'silent' }, sink),
    gateway,
  });
  return { app, prisma, gatewayCalls: calls };
}
