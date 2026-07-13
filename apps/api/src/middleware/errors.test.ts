import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { createLogger } from '../lib/logger.js';
import { AppError, createErrorHandler } from './errors.js';

function run(error: unknown, includeHints = true) {
  const sink = new Writable({ write: (_c, _e, cb) => cb() });
  const handler = createErrorHandler(createLogger({ level: 'silent' }, sink), { includeHints });

  let statusCode = 0;
  let body: { error: { code: string; message: string } } | undefined;
  const res = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(payload: never) {
      body = payload;
    },
  } as unknown as Response;

  handler(error, {} as Request, res, (() => {}) as NextFunction);
  return { statusCode, body };
}

class PrismaClientKnownRequestError extends Error {
  constructor(readonly code: string) {
    super('prisma known error');
    this.name = 'PrismaClientKnownRequestError';
  }
}

class PrismaClientInitializationError extends Error {
  constructor() {
    super('prisma init error');
    this.name = 'PrismaClientInitializationError';
  }
}

describe('error handler', () => {
  it('passes AppError through with status/code/meta', () => {
    const { statusCode, body } = run(
      new AppError(429, 'FLOOD_WAIT', 'slow down', { retryAfterSeconds: 9 }),
    );
    expect(statusCode).toBe(429);
    expect(body?.error).toMatchObject({ code: 'FLOOD_WAIT', retryAfterSeconds: 9 });
  });

  it('maps a missing-table Prisma error to DATABASE_NOT_MIGRATED with a hint in dev', () => {
    const { statusCode, body } = run(new PrismaClientKnownRequestError('P2021'));
    expect(statusCode).toBe(503);
    expect(body?.error.code).toBe('DATABASE_NOT_MIGRATED');
    expect(body?.error.message).toContain('prisma:deploy');
  });

  it('maps a Prisma initialization failure to DATABASE_UNREACHABLE', () => {
    const { statusCode, body } = run(new PrismaClientInitializationError());
    expect(statusCode).toBe(503);
    expect(body?.error.code).toBe('DATABASE_UNREACHABLE');
  });

  it('omits setup hints outside development', () => {
    const { body } = run(new PrismaClientKnownRequestError('P2021'), false);
    expect(body?.error.message).not.toContain('pnpm');
  });

  it('keeps unknown errors generic — no internals leak', () => {
    const { statusCode, body } = run(new Error('secret internal detail'));
    expect(statusCode).toBe(500);
    expect(body?.error.code).toBe('INTERNAL');
    expect(JSON.stringify(body)).not.toContain('secret internal detail');
  });
});
