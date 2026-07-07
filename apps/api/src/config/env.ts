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
