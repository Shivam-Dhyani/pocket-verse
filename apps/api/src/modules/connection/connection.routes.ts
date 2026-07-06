import { Router } from 'express';
import { startConnectionSchema, verifyCodeSchema, verifyPasswordSchema } from '@pocketverse/shared';
import type { JwtHelpers } from '../../lib/jwt.js';
import { requireAuth } from '../../middleware/auth.js';
import { validateBody } from '../../middleware/validate.js';
import { createConnectionController } from './connection.controller.js';
import type { ConnectionService } from './connection.service.js';

export function createConnectionRouter(service: ConnectionService, jwt: JwtHelpers): Router {
  const controller = createConnectionController(service);
  const router = Router();

  router.use(requireAuth(jwt));
  router.post('/start', validateBody(startConnectionSchema), controller.start);
  router.post('/verify-code', validateBody(verifyCodeSchema), controller.verifyCode);
  router.post('/verify-password', validateBody(verifyPasswordSchema), controller.verifyPassword);
  router.get('/', controller.status);
  router.post('/check', controller.check);
  router.delete('/', controller.disconnect);

  return router;
}
