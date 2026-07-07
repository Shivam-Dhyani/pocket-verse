import { z } from 'zod';

/**
 * Every env var the API needs, validated up front. The process refuses to
 * boot on invalid configuration instead of failing at first use.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  MASTER_KEYS: z.string().min(1),
  MASTER_KEY_ACTIVE: z.string().min(1),
  CORS_ORIGIN: z.string().url().default('http://localhost:3000'),
  // Preprocess so a missing/empty value reports "Required" instead of the
  // baffling "expected number, received nan" that z.coerce produces.
  TELEGRAM_API_ID: z.preprocess(
    (value) => (value === undefined || value === '' ? undefined : Number(value)),
    z
      .number({ required_error: 'Required', invalid_type_error: 'Must be a number' })
      .int()
      .positive(),
  ),
  TELEGRAM_API_HASH: z.string().min(16),
  // Queue backend: with REDIS_URL jobs run on BullMQ; without it an
  // in-process runner with the same retry policy is used (dev / no-Redis).
  REDIS_URL: z.string().url().optional(),
  // Telegram-level chunk size (handoff: 1.5GB default, tune later).
  CHUNK_SIZE_BYTES: z.coerce.number().int().positive().default(1_500_000_000),
  // HTTP upload part size — small enough for free-tier request timeouts.
  UPLOAD_PART_SIZE_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(8 * 1024 * 1024),
  // Disk staging area for in-flight upload chunks (relative to apps/api).
  STAGING_DIR: z.string().default('.staging'),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    // Configuration problems must be loud and fatal — but never echo values.
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

/** Token lifetimes — deliberately code constants, not env knobs. */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_DAYS = 30;
