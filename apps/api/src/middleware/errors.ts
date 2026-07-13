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

export interface ErrorHandlerOptions {
  /** Dev only: append actionable setup hints to database errors. */
  includeHints?: boolean;
}

export function createErrorHandler(logger: Logger, options: ErrorHandlerOptions = {}) {
  return (error: unknown, _req: Request, res: Response, _next: NextFunction): void => {
    if (error instanceof AppError) {
      res.status(error.status).json({
        error: { code: error.code, message: error.message, ...(error.meta ?? {}) },
      });
      return;
    }

    // Prisma failures during setup are common and fixable — say so honestly
    // instead of hiding them behind a generic 500.
    const database = classifyDatabaseError(error);
    if (database) {
      logger.error({ err: error }, database.logHint);
      res.status(503).json({
        error: {
          code: database.code,
          message: options.includeHints
            ? `${database.message} ${database.logHint}`
            : database.message,
        },
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

const SCHEMA_MISSING_CODES = new Set(['P2021', 'P2022']);
const UNREACHABLE_CODES = new Set(['P1000', 'P1001', 'P1002', 'P1003', 'P1017', 'P2024']);

function classifyDatabaseError(
  error: unknown,
): { code: string; message: string; logHint: string } | null {
  const candidate = error as { code?: unknown; name?: unknown; constructor?: { name?: string } };
  const prismaName = String(candidate?.name ?? candidate?.constructor?.name ?? '');
  if (!prismaName.startsWith('PrismaClient')) {
    return null;
  }

  // Connection/auth failures carry no P-code on the error object.
  if (prismaName === 'PrismaClientInitializationError') {
    return unreachable();
  }

  const prismaCode = typeof candidate.code === 'string' ? candidate.code : '';
  if (SCHEMA_MISSING_CODES.has(prismaCode)) {
    return {
      code: 'DATABASE_NOT_MIGRATED',
      message: 'The database is reachable but its tables are missing.',
      logHint: 'Run migrations: pnpm --filter @pocketverse/api prisma:deploy',
    };
  }
  if (UNREACHABLE_CODES.has(prismaCode)) {
    return unreachable();
  }
  return null;
}

function unreachable(): { code: string; message: string; logHint: string } {
  return {
    code: 'DATABASE_UNREACHABLE',
    message: 'The database is unreachable right now. Please try again shortly.',
    logHint:
      'Check DATABASE_URL: host, port, and credentials (Supabase: use the Session-pooler string on port 5432 and URL-encode special characters in the password).',
  };
}
