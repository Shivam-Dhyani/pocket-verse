import { createHash, randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import type { PrismaClient, User } from '@prisma/client';
import type { UserDto } from '@pocketverse/shared';
import { REFRESH_TOKEN_TTL_DAYS } from '../../config/env.js';
import type { JwtHelpers } from '../../lib/jwt.js';
import { AppError } from '../../middleware/errors.js';
import type { Mailer } from '../../lib/mailer.js';
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
  /** Sends password-reset links; absent in tests that don't exercise it. */
  mailer?: Mailer;
  /** Web origin used to build reset links (e.g. https://app.example.com). */
  webOrigin?: string;
}

const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;

const invalidCredentials = () =>
  new AppError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password');

const invalidRefresh = () =>
  new AppError(401, 'UNAUTHENTICATED', 'Session expired — sign in again');

export function createAuthService({ prisma, jwt, audit, mailer, webOrigin }: AuthServiceDeps) {
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

    /**
     * Change the password for a signed-in user. Every OTHER session is signed
     * out (their refresh tokens are revoked) — the session that made the
     * change keeps its refresh token so the user isn't logged out mid-action.
     */
    async changePassword(
      userId: string,
      currentPassword: string,
      newPassword: string,
      keepRefreshToken?: string,
    ): Promise<void> {
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) {
        throw invalidRefresh();
      }
      const valid = await argon2.verify(user.passwordHash, currentPassword);
      if (!valid) {
        throw new AppError(400, 'WRONG_PASSWORD', 'Your current password is incorrect.');
      }
      const passwordHash = await argon2.hash(newPassword, ARGON2_OPTIONS);
      await prisma.user.update({ where: { id: userId }, data: { passwordHash } });
      await prisma.refreshToken.updateMany({
        where: {
          userId,
          revokedAt: null,
          ...(keepRefreshToken ? { tokenHash: { not: hashToken(keepRefreshToken) } } : {}),
        },
        data: { revokedAt: new Date() },
      });
      await audit?.record(userId, AuditEventTypes.AUTH_PASSWORD_CHANGED);
    },

    /**
     * Start a password reset. Always resolves the same way whether or not the
     * email exists (no account probing); when it does, a single-use 30-minute
     * token is issued and the link is emailed (or logged when email isn't
     * configured).
     */
    async requestPasswordReset(email: string): Promise<void> {
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) {
        return;
      }
      const raw = randomBytes(32).toString('base64url');
      await prisma.passwordResetToken.create({
        data: {
          tokenHash: hashToken(raw),
          userId: user.id,
          expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
        },
      });
      const base = (webOrigin ?? 'http://localhost:3000').replace(/\/$/, '');
      await mailer?.sendPasswordReset(user.email, `${base}/reset-password?token=${raw}`);
      await audit?.record(user.id, AuditEventTypes.AUTH_PASSWORD_RESET_REQUESTED);
    },

    /** Complete a reset: consume the token, set the password, end every session. */
    async resetPassword(rawToken: string, newPassword: string): Promise<void> {
      const record = await prisma.passwordResetToken.findUnique({
        where: { tokenHash: hashToken(rawToken) },
      });
      if (!record || record.usedAt || record.expiresAt.getTime() <= Date.now()) {
        throw new AppError(
          400,
          'INVALID_RESET_TOKEN',
          'This reset link is invalid or has expired. Request a new one.',
        );
      }
      const passwordHash = await argon2.hash(newPassword, ARGON2_OPTIONS);
      await prisma.user.update({ where: { id: record.userId }, data: { passwordHash } });
      await prisma.passwordResetToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      });
      // A reset usually means the old password (and any stolen session) can't
      // be trusted — sign out everywhere.
      await prisma.refreshToken.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await audit?.record(record.userId, AuditEventTypes.AUTH_PASSWORD_RESET);
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
