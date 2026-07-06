import type { Request, Response } from 'express';
import type {
  StartConnectionInput,
  VerifyCodeInput,
  VerifyPasswordInput,
} from '@pocketverse/shared';
import type { ConnectionService } from './connection.service.js';

export function createConnectionController(service: ConnectionService) {
  return {
    async start(req: Request, res: Response): Promise<void> {
      const { phone } = req.body as StartConnectionInput;
      res.json({ connection: await service.start(req.user!.id, phone) });
    },

    async verifyCode(req: Request, res: Response): Promise<void> {
      const { code } = req.body as VerifyCodeInput;
      res.json({ connection: await service.verifyCode(req.user!.id, code) });
    },

    async verifyPassword(req: Request, res: Response): Promise<void> {
      const { password } = req.body as VerifyPasswordInput;
      res.json({ connection: await service.verifyPassword(req.user!.id, password) });
    },

    async status(req: Request, res: Response): Promise<void> {
      res.json({ connection: await service.getStatus(req.user!.id) });
    },

    async check(req: Request, res: Response): Promise<void> {
      res.json({ connection: await service.check(req.user!.id) });
    },

    async disconnect(req: Request, res: Response): Promise<void> {
      await service.disconnect(req.user!.id);
      res.status(204).end();
    },
  };
}
