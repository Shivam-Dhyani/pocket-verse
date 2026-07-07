import { once } from 'node:events';
import { Router, type Request, type Response } from 'express';
import { createUploadSchema, updateFileSchema } from '@pocketverse/shared';
import type { JwtHelpers } from '../../lib/jwt.js';
import { requireAuth } from '../../middleware/auth.js';
import { validateBody } from '../../middleware/validate.js';
import type { FilesService } from './files.service.js';

export function createFilesRouter(service: FilesService, jwt: JwtHelpers): Router {
  const router = Router();
  router.use(requireAuth(jwt));

  router.post('/uploads', validateBody(createUploadSchema), async (req, res) => {
    res.status(201).json({ upload: await service.createUpload(req.user!.id, req.body) });
  });

  router.get('/uploads/:id', async (req, res) => {
    res.json({ upload: await service.getUpload(req.user!.id, req.params.id) });
  });

  // Raw octet-stream part body — streamed straight to disk, never parsed.
  router.put('/uploads/:id/parts/:index', async (req, res) => {
    const partIndex = Number(req.params.index);
    const upload = await service.uploadPart(req.user!.id, req.params.id, partIndex, req);
    res.json({ upload });
  });

  router.delete('/uploads/:id', async (req, res) => {
    await service.abortUpload(req.user!.id, req.params.id);
    res.status(204).end();
  });

  router.get('/:id', async (req, res) => {
    res.json({ file: await service.getFile(req.user!.id, req.params.id) });
  });

  router.get('/:id/download', async (req, res) => {
    const { file, size, stream } = await service.download(req.user!.id, req.params.id);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Length', size.toString());
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    );
    await streamToResponse(stream, req, res);
  });

  router.patch('/:id', validateBody(updateFileSchema), async (req, res) => {
    res.json({ file: await service.updateFile(req.user!.id, String(req.params.id), req.body) });
  });

  router.delete('/:id', async (req, res) => {
    await service.deleteFile(req.user!.id, req.params.id);
    res.status(204).end();
  });

  return router;
}

/** Pipes the chunk stream to the response with backpressure + abort handling. */
async function streamToResponse(
  stream: AsyncIterable<Buffer>,
  req: Request,
  res: Response,
): Promise<void> {
  try {
    for await (const piece of stream) {
      if (res.destroyed || req.destroyed) {
        return; // client went away — stop pulling from storage
      }
      if (!res.write(piece)) {
        await once(res, 'drain');
      }
    }
    res.end();
  } catch (error) {
    if (res.headersSent) {
      // Mid-stream failure: the only honest option left is to cut the wire so
      // the client sees a failed (not silently truncated) download.
      res.destroy(error instanceof Error ? error : new Error('download failed'));
      return;
    }
    throw error;
  }
}
