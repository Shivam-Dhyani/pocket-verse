import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import type { PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
import type { Env } from './config/env.js';
import { loadMasterKeyring } from './lib/crypto/index.js';
import { createJwtHelpers } from './lib/jwt.js';
import { createKeyedMutex } from './lib/mutex.js';
import { createBullMqQueue, createInlineQueue, type JobQueue } from './lib/queue/index.js';
import type { TelegramGateway } from './lib/telegram/gateway.js';
import { createGramjsGateway } from './lib/telegram/gramjs.js';
import { createErrorHandler, notFoundHandler } from './middleware/errors.js';
import { createRateLimiters } from './middleware/rateLimit.js';
import { createActivityRouter, createStatsRouter } from './modules/activity/activity.routes.js';
import { createAuditService } from './modules/audit/audit.service.js';
import { createAuthRouter } from './modules/auth/auth.routes.js';
import { createAuthService } from './modules/auth/auth.service.js';
import { createConnectionRouter } from './modules/connection/connection.routes.js';
import { createConnectionService } from './modules/connection/connection.service.js';
import { createFilesRouter } from './modules/files/files.routes.js';
import { createFilesService } from './modules/files/files.service.js';
import { createStorageWorker } from './modules/files/storage.worker.js';
import { createDriveRouter, createFoldersRouter } from './modules/folders/folders.routes.js';
import { createFoldersService } from './modules/folders/folders.service.js';

export interface AppDeps {
  env: Env;
  prisma: PrismaClient;
  logger: Logger;
  /** Test seams — production builds these from env. */
  gateway?: TelegramGateway;
  queue?: JobQueue;
}

export function createApp({ env, prisma, logger, gateway, queue }: AppDeps): express.Express {
  const app = express();
  const jwt = createJwtHelpers(env.JWT_SECRET);
  const keyring = loadMasterKeyring(env);
  const limiters = createRateLimiters(env.NODE_ENV);
  const audit = createAuditService({ prisma, logger });
  const lock = createKeyedMutex();
  const telegramGateway =
    gateway ?? createGramjsGateway({ apiId: env.TELEGRAM_API_ID, apiHash: env.TELEGRAM_API_HASH });

  const jobQueue =
    queue ?? (env.REDIS_URL ? createBullMqQueue(env.REDIS_URL, logger) : createInlineQueue(logger));
  const worker = createStorageWorker({
    prisma,
    gateway: telegramGateway,
    keyring,
    audit,
    lock,
    logger,
  });
  jobQueue.register(worker.handlers, worker.onFinalFailure);

  app.disable('x-powered-by');
  // Production runs behind a reverse proxy (Render/Koyeb). Without this,
  // every request appears to come from the proxy's IP and the rate limiters
  // would throttle all users as one client.
  if (env.NODE_ENV === 'production') {
    app.set('trust proxy', 1);
  }
  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  // The whole authenticated storage surface is exempt from the general budget:
  // a single folder upload is legitimately hundreds of requests (one session
  // per file, one ensure-path per directory, plus drive re-polls). Those routes
  // are JWT-gated and carry their own generous limiter below. The general
  // budget stays tight to guard unauthenticated/abuse traffic.
  app.use(
    limiters.general({
      skip: (req) => /^\/api\/(files|folders|drive|activity|stats)(\/|$)/.test(req.path),
    }),
  );

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  const authService = createAuthService({ prisma, jwt, audit });
  app.use(
    '/api/auth',
    limiters.auth,
    createAuthRouter({
      service: authService,
      jwt,
      secureCookies: env.NODE_ENV === 'production',
    }),
  );

  const connectionService = createConnectionService({
    prisma,
    gateway: telegramGateway,
    keyring,
    audit,
    lock,
  });
  app.use('/api/connection', limiters.connection, createConnectionRouter(connectionService, jwt));

  const filesService = createFilesService({
    prisma,
    keyring,
    gateway: telegramGateway,
    queue: jobQueue,
    audit,
    config: {
      chunkSizeBytes: env.CHUNK_SIZE_BYTES,
      partSizeBytes: env.UPLOAD_PART_SIZE_BYTES,
      stagingDir: env.STAGING_DIR,
    },
  });
  const foldersService = createFoldersService({
    prisma,
    queue: jobQueue,
    audit,
    stagingDir: env.STAGING_DIR,
  });
  // Folder uploads fan out to these routes as heavily as file parts do, so they
  // share the same generous storage budget rather than the tight general one.
  app.use('/api/files', limiters.uploads, createFilesRouter(filesService, jwt, env.CORS_ORIGIN));
  app.use('/api/folders', limiters.uploads, createFoldersRouter(foldersService, jwt));
  app.use('/api/drive', limiters.uploads, createDriveRouter(foldersService, jwt));
  app.use('/api/activity', limiters.uploads, createActivityRouter(prisma, jwt));
  app.use('/api/stats', limiters.uploads, createStatsRouter(prisma, jwt));

  app.use(notFoundHandler);
  app.use(createErrorHandler(logger, { includeHints: env.NODE_ENV !== 'production' }));

  return app;
}
