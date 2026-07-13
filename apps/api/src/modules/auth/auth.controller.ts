import type { CookieOptions, Request, Response } from 'express';
import type {
  ChangePasswordInput,
  ForgotPasswordInput,
  LoginInput,
  RegisterInput,
  ResetPasswordInput,
} from '@pocketverse/shared';
import type { AuthService, IssuedTokens } from './auth.service.js';

export const REFRESH_COOKIE = 'pv_refresh';

export interface AuthControllerDeps {
  service: AuthService;
  secureCookies: boolean;
}

export function createAuthController({ service, secureCookies }: AuthControllerDeps) {
  // In production the web app and API live on different sites (e.g. vercel.app
  // → onrender.com), and browsers drop SameSite=Strict cookies on cross-site
  // requests entirely — sessions would silently never survive a reload. Cross-
  // site cookies require SameSite=None together with Secure; locally (same
  // site, plain http) Strict is the tighter and working choice.
  const sameSite = secureCookies ? 'none' : 'strict';
  const cookieOptions = (expiresAt: Date): CookieOptions => ({
    httpOnly: true,
    secure: secureCookies,
    sameSite,
    path: '/api/auth',
    expires: expiresAt,
  });

  function setRefreshCookie(res: Response, tokens: IssuedTokens): void {
    res.cookie(
      REFRESH_COOKIE,
      tokens.refreshToken.raw,
      cookieOptions(tokens.refreshToken.expiresAt),
    );
  }

  function clearRefreshCookie(res: Response): void {
    res.clearCookie(REFRESH_COOKIE, { path: '/api/auth', secure: secureCookies, sameSite });
  }

  return {
    async register(req: Request, res: Response): Promise<void> {
      const { email, password } = req.body as RegisterInput;
      const result = await service.register(email, password);
      setRefreshCookie(res, result);
      res.status(201).json({ user: result.user, accessToken: result.accessToken });
    },

    async login(req: Request, res: Response): Promise<void> {
      const { email, password } = req.body as LoginInput;
      const result = await service.login(email, password);
      setRefreshCookie(res, result);
      res.json({ user: result.user, accessToken: result.accessToken });
    },

    async refresh(req: Request, res: Response): Promise<void> {
      const raw = (req.cookies as Record<string, string | undefined>)[REFRESH_COOKIE];
      if (!raw) {
        res
          .status(401)
          .json({ error: { code: 'UNAUTHENTICATED', message: 'Session expired — sign in again' } });
        return;
      }
      const result = await service.refresh(raw);
      setRefreshCookie(res, result);
      res.json({ user: result.user, accessToken: result.accessToken });
    },

    async logout(req: Request, res: Response): Promise<void> {
      const raw = (req.cookies as Record<string, string | undefined>)[REFRESH_COOKIE];
      if (raw) {
        await service.logout(raw);
      }
      clearRefreshCookie(res);
      res.status(204).end();
    },

    async me(req: Request, res: Response): Promise<void> {
      // requireAuth guarantees req.user.
      const user = await service.getUser(req.user!.id);
      res.json({ user });
    },

    async changePassword(req: Request, res: Response): Promise<void> {
      const { currentPassword, newPassword } = req.body as ChangePasswordInput;
      // The cookie rides along (this route lives under /api/auth) — keep this
      // session alive while every other one is signed out.
      const current = (req.cookies as Record<string, string | undefined>)[REFRESH_COOKIE];
      await service.changePassword(req.user!.id, currentPassword, newPassword, current);
      res.status(204).end();
    },

    async forgotPassword(req: Request, res: Response): Promise<void> {
      const { email } = req.body as ForgotPasswordInput;
      await service.requestPasswordReset(email);
      // Identical response whether or not the account exists.
      res.status(204).end();
    },

    async resetPassword(req: Request, res: Response): Promise<void> {
      const { token, password } = req.body as ResetPasswordInput;
      await service.resetPassword(token, password);
      res.status(204).end();
    },
  };
}
