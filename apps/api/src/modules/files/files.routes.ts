import { once } from 'node:events';
import { Router, type Request, type RequestHandler, type Response } from 'express';
import { createUploadSchema, updateFileSchema } from '@pocketverse/shared';
import type { JwtHelpers } from '../../lib/jwt.js';
import { requireAuth } from '../../middleware/auth.js';
import { validateBody } from '../../middleware/validate.js';
import type { FilesService } from './files.service.js';

/**
 * Downloads run as plain browser navigations (native download UI with its own
 * progress bar), so they authenticate with a short-lived single-file token in
 * the query string instead of an Authorization header. Bearer auth still
 * works for programmatic access.
 */
function requireAuthOrDownloadToken(jwt: JwtHelpers): RequestHandler {
  const bearer = requireAuth(jwt);
  return async (req, res, next) => {
    const token = typeof req.query.token === 'string' ? req.query.token : undefined;
    if (!token) {
      return bearer(req, res, next);
    }
    try {
      const claims = await jwt.verifyDownloadToken(token);
      if (claims.fileId !== req.params.id) {
        throw new Error('token/file mismatch');
      }
      req.user = { id: claims.sub, email: '' };
      next();
    } catch {
      res.status(401).json({
        error: {
          code: 'DOWNLOAD_LINK_EXPIRED',
          message: 'This download link expired. Go back to your drive and download again.',
        },
      });
    }
  };
}

export function createFilesRouter(
  service: FilesService,
  jwt: JwtHelpers,
  webOrigin: string,
): Router {
  const router = Router();

  // Registered before the bearer guard: token-authenticated navigation.
  router.get('/:id/download', requireAuthOrDownloadToken(jwt), async (req, res) => {
    const { file, size, stream } = await service.download(req.user!.id, String(req.params.id));

    // Inline preview is honored ONLY for types that render safely in a browser
    // (images, PDF). Anything else is forced to attachment so a stored HTML
    // file can never execute in our origin — even if someone crafts the URL.
    const wantsInline = req.query.disposition === 'inline';
    const inline = wantsInline && isPreviewable(file.mimeType);

    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Length', size.toString());
    res.setHeader(
      'Content-Disposition',
      `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    );

    if (inline) {
      // The web app is a separate origin, so Helmet's default same-origin
      // resource/frame policy blocks embedding. Relax JUST for safe previews:
      // let the web origin load the image and frame the PDF.
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      res.removeHeader('X-Frame-Options');
      res.setHeader('Content-Security-Policy', `frame-ancestors 'self' ${webOrigin}`);
    }

    await streamToResponse(stream, req, res);
  });

  router.use(requireAuth(jwt));

  router.get('/search', async (req, res) => {
    const query = typeof req.query.q === 'string' ? req.query.q : '';
    res.json({ results: await service.search(req.user!.id, query) });
  });

  router.post('/:id/download-token', async (req, res) => {
    // Ownership (and existence) check happens in getFile.
    const file = await service.getFile(req.user!.id, String(req.params.id));
    const token = await jwt.signDownloadToken(req.user!.id, file.id);
    res.json({ token });
  });

  router.post('/uploads', validateBody(createUploadSchema), async (req, res) => {
    res.status(201).json({ upload: await service.createUpload(req.user!.id, req.body) });
  });

  // Re-enqueue failed syncs whose staged bytes we still hold.
  router.post('/retry-failed', async (req, res) => {
    res.json(await service.retryFailed(req.user!.id));
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

  router.patch('/:id', validateBody(updateFileSchema), async (req, res) => {
    res.json({ file: await service.updateFile(req.user!.id, String(req.params.id), req.body) });
  });

  router.delete('/:id', async (req, res) => {
    await service.deleteFile(req.user!.id, req.params.id);
    res.status(204).end();
  });

  return router;
}

/** Types the browser can safely render inline (must match the web client). */
export function isPreviewable(mimeType: string): boolean {
  return mimeType.startsWith('image/') || mimeType === 'application/pdf';
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
