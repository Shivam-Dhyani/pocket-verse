import { createHash, randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import type { PrismaClient, User } from '@prisma/client';
import type { UserDto } from '@pocketverse/shared';
import { REFRESH_TOKEN_TTL_DAYS } from '../../config/env.js';
import type { JwtHelpers } from '../../lib/jwt.js';
import { AppError } from '../../middleware/errors.js';
import { AuditEventTypes, type AuditService } from '../audit/audit.service.js';

const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19 * 1024, // 19 MiB — OWASP baseline for argon2id
  timeCost: 2,
  parallelism: 1,
};

export interface IssuedTokens {
  accessToken: string;
  refreshToken: { raw: string; expiresAt: Date };
}

export interface AuthResult extends IssuedTokens {
  user: UserDto;
}

export interface AuthServiceDeps {
  prisma: PrismaClient;
  jwt: JwtHelpers;
  audit?: AuditService;
}

const invalidCredentials = () =>
  new AppError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password');

const invalidRefresh = () =>
  new AppError(401, 'UNAUTHENTICATED', 'Session expired — sign in again');

export function createAuthService({ prisma, jwt, audit }: AuthServiceDeps) {
  async function issueTokens(user: User): Promise<AuthResult> {
    const raw = randomBytes(48).toString('base64url');
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

    await prisma.refreshToken.create({
      data: { tokenHash: hashToken(raw), userId: user.id, expiresAt },
    });

    return {
      user: toUserDto(user),
      accessToken: await jwt.signAccessToken({ sub: user.id, email: user.email }),
      refreshToken: { raw, expiresAt },
    };
  }

  return {
    async register(email: string, password: string): Promise<AuthResult> {
      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) {
        throw new AppError(409, 'EMAIL_TAKEN', 'An account with this email already exists');
      }

      const passwordHash = await argon2.hash(password, ARGON2_OPTIONS);
      const user = await prisma.user.create({ data: { email, passwordHash } });
      await audit?.record(user.id, AuditEventTypes.AUTH_REGISTER);
      return issueTokens(user);
    },

    async login(email: string, password: string): Promise<AuthResult> {
      const user = await prisma.user.findUnique({ where: { email } });
      // Same error for unknown email and wrong password — no account probing.
      if (!user) {
        throw invalidCredentials();
      }
      const valid = await argon2.verify(user.passwordHash, password);
      if (!valid) {
        throw invalidCredentials();
      }
      await audit?.record(user.id, AuditEventTypes.AUTH_LOGIN);
      return issueTokens(user);
    },

    async refresh(rawToken: string): Promise<AuthResult> {
      const record = await prisma.refreshToken.findUnique({
        where: { tokenHash: hashToken(rawToken) },
        include: { user: true },
      });
      if (!record) {
        throw invalidRefresh();
      }

      if (record.revokedAt) {
        // Reuse of a rotated token = possible theft. Kill every session.
        await prisma.refreshToken.updateMany({
          where: { userId: record.userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        throw invalidRefresh();
      }

      if (record.expiresAt.getTime() <= Date.now()) {
        throw invalidRefresh();
      }

      await prisma.refreshToken.update({
        where: { id: record.id },
        data: { revokedAt: new Date() },
      });
      return issueTokens(record.user);
    },

    async logout(rawToken: string): Promise<void> {
      await prisma.refreshToken.updateMany({
        where: { tokenHash: hashToken(rawToken), revokedAt: null },
        data: { revokedAt: new Date() },
      });
    },

    async getUser(userId: string): Promise<UserDto> {
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) {
        throw invalidRefresh();
      }
      return toUserDto(user);
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

function toUserDto(user: User): UserDto {
  return { id: user.id, email: user.email, createdAt: user.createdAt.toISOString() };
}
