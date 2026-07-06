import { Router } from 'express';
import { loginSchema, registerSchema } from '@pocketverse/shared';
import type { JwtHelpers } from '../../lib/jwt.js';
import { requireAuth } from '../../middleware/auth.js';
import { validateBody } from '../../middleware/validate.js';
import { createAuthController } from './auth.controller.js';
import type { AuthService } from './auth.service.js';

export interface AuthRouterDeps {
  service: AuthService;
  jwt: JwtHelpers;
  secureCookies: boolean;
}

export function createAuthRouter({ service, jwt, secureCookies }: AuthRouterDeps): Router {
  const controller = createAuthController({ service, secureCookies });
  const router = Router();

  router.post('/register', validateBody(registerSchema), controller.register);
  router.post('/login', validateBody(loginSchema), controller.login);
  router.post('/refresh', controller.refresh);
  router.post('/logout', controller.logout);
  router.get('/me', requireAuth(jwt), controller.me);

  return router;
}
