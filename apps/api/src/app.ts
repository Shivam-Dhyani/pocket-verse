import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import type { PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
import type { Env } from './config/env.js';
import { createJwtHelpers } from './lib/jwt.js';
import { createErrorHandler, notFoundHandler } from './middleware/errors.js';
import { createRateLimiters } from './middleware/rateLimit.js';
import { createAuthRouter } from './modules/auth/auth.routes.js';
import { createAuthService } from './modules/auth/auth.service.js';

export interface AppDeps {
  env: Env;
  prisma: PrismaClient;
  logger: Logger;
}

export function createApp({ env, prisma, logger }: AppDeps): express.Express {
  const app = express();
  const jwt = createJwtHelpers(env.JWT_SECRET);
  const limiters = createRateLimiters(env.NODE_ENV);

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use(limiters.general);

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  const authService = createAuthService({ prisma, jwt });
  app.use(
    '/api/auth',
    limiters.auth,
    createAuthRouter({
      service: authService,
      jwt,
      secureCookies: env.NODE_ENV === 'production',
    }),
  );

  app.use(notFoundHandler);
  app.use(createErrorHandler(logger));

  return app;
}
