import { Router } from 'express';
import {
  createFolderSchema,
  ensureFolderPathSchema,
  updateFolderSchema,
} from '@pocketverse/shared';
import type { JwtHelpers } from '../../lib/jwt.js';
import { requireAuth } from '../../middleware/auth.js';
import { validateBody } from '../../middleware/validate.js';
import type { FoldersService } from './folders.service.js';

export function createFoldersRouter(service: FoldersService, jwt: JwtHelpers): Router {
  const router = Router();
  router.use(requireAuth(jwt));

  router.post('/', validateBody(createFolderSchema), async (req, res) => {
    res.status(201).json({ folder: await service.createFolder(req.user!.id, req.body) });
  });

  router.post('/ensure-path', validateBody(ensureFolderPathSchema), async (req, res) => {
    const { parentId, segments } = req.body;
    res.json(await service.ensureFolderPath(req.user!.id, parentId ?? null, segments));
  });

  router.patch('/:id', validateBody(updateFolderSchema), async (req, res) => {
    res.json({
      folder: await service.updateFolder(req.user!.id, String(req.params.id), req.body),
    });
  });

  router.delete('/:id', async (req, res) => {
    await service.deleteFolder(req.user!.id, req.params.id);
    res.status(204).end();
  });

  return router;
}

export function createDriveRouter(service: FoldersService, jwt: JwtHelpers): Router {
  const router = Router();
  router.use(requireAuth(jwt));

  router.get('/', async (req, res) => {
    const folderId = typeof req.query.folderId === 'string' ? req.query.folderId : null;
    res.json(await service.listDrive(req.user!.id, folderId || null));
  });

  return router;
}
