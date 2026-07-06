import type { RequestHandler } from 'express';
import type { JwtHelpers } from '../lib/jwt.js';

export interface AuthenticatedUser {
  id: string;
  email: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

/** Bearer-token guard: verifies the access JWT and attaches req.user. */
export function requireAuth(jwt: JwtHelpers): RequestHandler {
  return async (req, res, next) => {
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;

    if (!token) {
      res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in to continue' } });
      return;
    }

    try {
      const claims = await jwt.verifyAccessToken(token);
      req.user = { id: claims.sub, email: claims.email };
      next();
    } catch {
      res
        .status(401)
        .json({ error: { code: 'UNAUTHENTICATED', message: 'Session expired — sign in again' } });
    }
  };
}
