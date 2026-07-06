import { z } from 'zod';

export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{6,14}$/, 'Use international format, e.g. +14155552671');

export const startConnectionSchema = z.object({
  phone: phoneSchema,
});

export const verifyCodeSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{4,6}$/, 'Enter the numeric code you received'),
});

export const verifyPasswordSchema = z.object({
  password: z.string().min(1, 'Enter your two-step verification password').max(256),
});

export const connectionStatusValues = [
  'none',
  'pending_code',
  'pending_password',
  'connected',
  'error',
] as const;

export const connectionDtoSchema = z.object({
  status: z.enum(connectionStatusValues),
  phoneMasked: z.string().nullable(),
  channelReady: z.boolean(),
  lastCheckedAt: z.string().datetime().nullable(),
  lastError: z.string().nullable(),
});

export type StartConnectionInput = z.infer<typeof startConnectionSchema>;
export type VerifyCodeInput = z.infer<typeof verifyCodeSchema>;
export type VerifyPasswordInput = z.infer<typeof verifyPasswordSchema>;
export type ConnectionStatusValue = (typeof connectionStatusValues)[number];
export type ConnectionDto = z.infer<typeof connectionDtoSchema>;
