import { z } from 'zod';

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('Enter a valid email address')
  .max(254);

export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(128, 'Use at most 128 characters');

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});

export const loginSchema = z.object({
  email: emailSchema,
  // Login accepts any non-empty password — policy checks belong to registration only.
  password: z.string().min(1, 'Enter your password').max(128),
});

export const userDtoSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  createdAt: z.string().datetime(),
});

export const authResponseSchema = z.object({
  user: userDtoSchema,
  accessToken: z.string(),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type UserDto = z.infer<typeof userDtoSchema>;
export type AuthResponse = z.infer<typeof authResponseSchema>;
