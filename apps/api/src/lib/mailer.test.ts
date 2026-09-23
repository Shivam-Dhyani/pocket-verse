import { Writable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from './logger.js';
import { createMailer } from './mailer.js';

const MAIL = {
  userId: 'user_123',
  email: 'shivam.dhyani@gmail.com',
  resetUrl: 'https://app.example.com/reset-password?token=live-secret-token',
};

function captureLogger() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(String(chunk));
      callback();
    },
  });
  return {
    logger: createLogger({ level: 'info' }, stream),
    entries: () => lines.map((line) => JSON.parse(line) as Record<string, unknown>),
    raw: () => lines.join(''),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('mailer logging', () => {
  it('logs a sent email by userId + masked address + Resend id, never the address or link', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ id: 'resend_abc' }), { status: 200 })),
    );
    const log = captureLogger();
    await createMailer(
      { resendApiKey: 'k', mailFrom: 'P <a@b.com>' },
      log.logger,
    ).sendPasswordReset(MAIL);

    expect(log.entries()).toHaveLength(1);
    expect(log.entries()[0]).toMatchObject({
      event: 'mail.password_reset',
      outcome: 'sent',
      userId: 'user_123',
      to: 'sh***@g***.com',
      resendId: 'resend_abc',
    });
    expect(log.raw()).not.toContain('shivam.dhyani');
    expect(log.raw()).not.toContain('live-secret-token');
  });

  it('logs a rejection with the reason, without the address or link', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"message":"domain is not verified"}', { status: 403 })),
    );
    const log = captureLogger();
    await createMailer(
      { resendApiKey: 'k', mailFrom: 'P <a@b.com>' },
      log.logger,
    ).sendPasswordReset(MAIL);

    expect(log.entries()[0]).toMatchObject({ outcome: 'rejected', status: 403 });
    expect(log.raw()).toContain('domain is not verified');
    expect(log.raw()).not.toContain('shivam.dhyani');
    expect(log.raw()).not.toContain('live-secret-token');
  });

  it('logs a network failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNRESET');
      }),
    );
    const log = captureLogger();
    await createMailer(
      { resendApiKey: 'k', mailFrom: 'P <a@b.com>' },
      log.logger,
    ).sendPasswordReset(MAIL);
    expect(log.entries()[0]).toMatchObject({ outcome: 'failed', userId: 'user_123' });
  });

  it('in production, reports missing config without logging the reset link', async () => {
    const log = captureLogger();
    await createMailer({}, log.logger).sendPasswordReset(MAIL);

    expect(log.entries()[0]).toMatchObject({ outcome: 'not_configured', userId: 'user_123' });
    expect(log.raw()).not.toContain('live-secret-token');
    expect(log.raw()).not.toContain('shivam.dhyani');
  });

  it('in local development, logs the link so the flow is testable', async () => {
    const log = captureLogger();
    await createMailer({ logResetLinks: true }, log.logger).sendPasswordReset(MAIL);
    expect(log.raw()).toContain('live-secret-token');
  });
});
