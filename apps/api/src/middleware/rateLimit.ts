import { rateLimit } from 'express-rate-limit';

const FIFTEEN_MINUTES = 15 * 60 * 1000;

/**
 * Rate limits are part of the security posture (credential stuffing, and —
 * from Phase 2 — protecting users' storage accounts from flood limits).
 * Tests get effectively-unlimited buckets so suites stay deterministic.
 */
export function createRateLimiters(nodeEnv: string) {
  const testing = nodeEnv === 'test';

  return {
    general: rateLimit({
      windowMs: FIFTEEN_MINUTES,
      limit: testing ? 100_000 : 300,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
    }),
    auth: rateLimit({
      windowMs: FIFTEEN_MINUTES,
      limit: testing ? 100_000 : 20,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: {
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many attempts. Wait a few minutes and try again.',
        },
      },
    }),
    // OTP sends are expensive for the user's account (flood limits, abuse).
    connection: rateLimit({
      windowMs: FIFTEEN_MINUTES,
      limit: testing ? 100_000 : 15,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: {
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many connection attempts. Wait a few minutes and try again.',
        },
      },
    }),
  };
}
