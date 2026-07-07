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
import type { TelegramGateway } from './lib/telegram/gateway.js';
import { createGramjsGateway } from './lib/telegram/gramjs.js';
import { createErrorHandler, notFoundHandler } from './middleware/errors.js';
import { createRateLimiters } from './middleware/rateLimit.js';
import { createAuditService } from './modules/audit/audit.service.js';
import { createAuthRouter } from './modules/auth/auth.routes.js';
import { createAuthService } from './modules/auth/auth.service.js';
import { createConnectionRouter } from './modules/connection/connection.routes.js';
import { createConnectionService } from './modules/connection/connection.service.js';

export interface AppDeps {
  env: Env;
  prisma: PrismaClient;
  logger: Logger;
  /** Test seam — production builds the GramJS gateway from env. */
  gateway?: TelegramGateway;
}

export function createApp({ env, prisma, logger, gateway }: AppDeps): express.Express {
  const app = express();
  const jwt = createJwtHelpers(env.JWT_SECRET);
  const keyring = loadMasterKeyring(env);
  const limiters = createRateLimiters(env.NODE_ENV);
  const audit = createAuditService({ prisma, logger });
  const telegramGateway =
    gateway ?? createGramjsGateway({ apiId: env.TELEGRAM_API_ID, apiHash: env.TELEGRAM_API_HASH });

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use(limiters.general);

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
    lock: createKeyedMutex(),
  });
  app.use('/api/connection', limiters.connection, createConnectionRouter(connectionService, jwt));

  app.use(notFoundHandler);
  app.use(createErrorHandler(logger, { includeHints: env.NODE_ENV !== 'production' }));

  return app;
}
