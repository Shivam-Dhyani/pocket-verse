import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { createApp } from '../app.js';
import type { Env } from '../config/env.js';
import { createLogger } from '../lib/logger.js';
import { createInlineQueue } from '../lib/queue/index.js';
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
  REDIS_URL: undefined,
  CHUNK_SIZE_BYTES: 1_500_000_000,
  UPLOAD_PART_SIZE_BYTES: 8 * 1024 * 1024,
  STAGING_DIR: path.join(tmpdir(), 'pocketverse-test-staging'),
};

export interface TestAppOptions {
  gateway?: FakeGatewayOptions;
  env?: Partial<Env>;
}

export function createTestApp(options: TestAppOptions | FakeGatewayOptions = {}) {
  // Back-compat: earlier tests pass FakeGatewayOptions directly.
  const normalized: TestAppOptions =
    'gateway' in options || 'env' in options
      ? (options as TestAppOptions)
      : { gateway: options as FakeGatewayOptions };

  const prisma = createFakePrisma();
  const { gateway, calls, channelStore } = createFakeGateway(normalized.gateway ?? {});
  const sink = new Writable({ write: (_c, _e, cb) => cb() });
  const logger = createLogger({ level: 'silent' }, sink);
  const queue = createInlineQueue(logger, { attempts: 3, backoffMs: 1 });

  const env: Env = {
    ...TEST_ENV,
    // Isolated staging dir per app instance so parallel tests never collide.
    STAGING_DIR: path.join(tmpdir(), `pocketverse-test-${randomUUID()}`),
    ...normalized.env,
  };

  const app = createApp({ env, prisma, logger, gateway, queue });
  return { app, prisma, gatewayCalls: calls, channelStore, queue, env };
}
