import type { NextFunction, Request, Response } from 'express';
import type { Logger } from 'pino';

/**
 * Operational errors we intentionally return to clients. Anything else is a
 * bug and surfaces as a generic 500 — internals never leak into responses.
 */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** Safe, client-facing extras (e.g. retryAfterSeconds) — never internals. */
    readonly meta?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Resource not found' } });
}

export function createErrorHandler(logger: Logger) {
  return (error: unknown, _req: Request, res: Response, _next: NextFunction): void => {
    if (error instanceof AppError) {
      res.status(error.status).json({
        error: { code: error.code, message: error.message, ...(error.meta ?? {}) },
      });
      return;
    }

    logger.error({ err: error }, 'Unhandled error');
    res.status(500).json({
      error: {
        code: 'INTERNAL',
        message: 'Something went wrong on our side. Please try again.',
      },
    });
  };
}
