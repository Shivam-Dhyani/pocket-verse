import { Router, type RequestHandler } from 'express';
import { startConnectionSchema, verifyCodeSchema, verifyPasswordSchema } from '@pocketverse/shared';
import type { JwtHelpers } from '../../lib/jwt.js';
import { requireAuth } from '../../middleware/auth.js';
import { validateBody } from '../../middleware/validate.js';
import { createConnectionController } from './connection.controller.js';
import type { ConnectionService } from './connection.service.js';

export function createConnectionRouter(
  service: ConnectionService,
  jwt: JwtHelpers,
  /** Strict limiter for the OTP-sending endpoints ONLY — sending sign-in codes
   *  is expensive/abusable. Status polling, phone reveal, health checks and
   *  disconnect are ordinary authenticated reads and must never eat this
   *  budget (the drive polls status every 30s). */
  otpLimiter?: RequestHandler,
): Router {
  const controller = createConnectionController(service);
  const router = Router();
  const strict: RequestHandler[] = otpLimiter ? [otpLimiter] : [];

  router.use(requireAuth(jwt));
  router.post('/start', ...strict, validateBody(startConnectionSchema), controller.start);
  router.post('/verify-code', ...strict, validateBody(verifyCodeSchema), controller.verifyCode);
  router.post(
    '/verify-password',
    ...strict,
    validateBody(verifyPasswordSchema),
    controller.verifyPassword,
  );
  router.get('/', controller.status);
  router.get('/phone', controller.revealPhone);
  router.post('/check', controller.check);
  router.delete('/', controller.disconnect);

  return router;
}
