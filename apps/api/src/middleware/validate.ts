import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ZodTypeAny } from 'zod';

/**
 * Zod-validate the request body before the handler runs. On success the body
 * is replaced with the parsed (trimmed/normalized) value; on failure the
 * client gets a 400 with field-level messages and the handler never runs.
 */
export function validateBody(schema: ZodTypeAny): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({
        error: {
          code: 'VALIDATION',
          message: 'Request validation failed',
          details: result.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
      });
      return;
    }
    req.body = result.data;
    next();
  };
}
