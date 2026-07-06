import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger } from './logger.js';

function captureLogger() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(String(chunk));
      callback();
    },
  });
  return { logger: createLogger({ level: 'info' }, stream), lines };
}

describe('logger redaction', () => {
  it('redacts secrets at any nesting level', () => {
    const { logger, lines } = captureLogger();

    logger.info(
      {
        user: { password: 'hunter2-plaintext', passwordHash: '$argon2id$fake' },
        auth: { accessToken: 'eyJhbGciOi.fake.jwt', refreshToken: 'raw-refresh-token' },
        connection: { sessionString: '1BQANOTAREALSESSION' },
      },
      'login attempt',
    );
    logger.flush?.();

    const output = lines.join('');
    expect(output).toContain('[REDACTED]');
    expect(output).not.toContain('hunter2-plaintext');
    expect(output).not.toContain('$argon2id$fake');
    expect(output).not.toContain('eyJhbGciOi.fake.jwt');
    expect(output).not.toContain('raw-refresh-token');
    expect(output).not.toContain('1BQANOTAREALSESSION');
  });

  it('redacts authorization and cookie headers on req objects', () => {
    const { logger, lines } = captureLogger();

    logger.info({
      req: { headers: { authorization: 'Bearer secret-token', cookie: 'pv_refresh=raw-value' } },
    });
    logger.flush?.();

    const output = lines.join('');
    expect(output).not.toContain('secret-token');
    expect(output).not.toContain('raw-value');
  });

  it('still logs ordinary fields', () => {
    const { logger, lines } = captureLogger();
    logger.info({ userId: 'user_123', route: '/api/auth/login' }, 'ok');
    logger.flush?.();

    const output = lines.join('');
    expect(output).toContain('user_123');
    expect(output).toContain('/api/auth/login');
  });
});
