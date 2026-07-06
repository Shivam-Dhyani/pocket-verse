import { pino } from 'pino';
import type { Logger, DestinationStream } from 'pino';

/**
 * Structured logging with hard redaction. Session strings, tokens, passwords
 * and key material must never reach a log line — redaction is enforced here,
 * not left to caller discipline.
 */

export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.password',
  '*.passwordHash',
  '*.accessToken',
  '*.refreshToken',
  '*.token',
  '*.tokenHash',
  '*.session',
  '*.sessionString',
  '*.wrappedKey',
  '*.dataKey',
  '*.masterKey',
  '*.secret',
  '*.jwt',
];

export function createLogger(
  options: { level?: string; pretty?: boolean } = {},
  destination?: DestinationStream,
): Logger {
  const logger = pino(
    {
      level: options.level ?? 'info',
      redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
      base: undefined,
      ...(options.pretty
        ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
        : {}),
    },
    destination,
  );
  return logger;
}
