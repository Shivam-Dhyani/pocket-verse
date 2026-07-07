import { rateLimit, type Options } from 'express-rate-limit';
import type { Request } from 'express';

const FIFTEEN_MINUTES = 15 * 60 * 1000;

/**
 * Rate limits are part of the security posture (credential stuffing, OTP
 * abuse, and protecting users' storage accounts from flood limits). Tests get
 * effectively-unlimited buckets so suites stay deterministic.
 */
export function createRateLimiters(nodeEnv: string) {
  const testing = nodeEnv === 'test';

  const message = (text: string) => ({
    error: { code: 'RATE_LIMITED', message: text },
  });

  const base = {
    windowMs: FIFTEEN_MINUTES,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
  } satisfies Partial<Options>;

  return {
    /** App-wide budget; callers can exempt specific traffic via `skip`. */
    general: (options: { skip?: (req: Request) => boolean } = {}) =>
      rateLimit({
        ...base,
        limit: testing ? 100_000 : 300,
        skip: options.skip,
      }),
    auth: rateLimit({
      ...base,
      limit: testing ? 100_000 : 20,
      message: message('Too many attempts. Wait a few minutes and try again.'),
    }),
    // OTP sends are expensive for the user's account (flood limits, abuse).
    connection: rateLimit({
      ...base,
      limit: testing ? 100_000 : 15,
      message: message('Too many connection attempts. Wait a few minutes and try again.'),
    }),
    // Large files are thousands of part requests by design.
    uploads: rateLimit({
      ...base,
      limit: testing ? 100_000 : 10_000,
      message: message('Too many storage requests. Wait a few minutes and try again.'),
    }),
  };
}
