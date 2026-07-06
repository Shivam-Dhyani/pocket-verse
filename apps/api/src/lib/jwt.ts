import { SignJWT, jwtVerify } from 'jose';
import { ACCESS_TOKEN_TTL_SECONDS } from '../config/env.js';

const ISSUER = 'pocketverse';
const AUDIENCE = 'pocketverse:web';

export interface AccessTokenClaims {
  /** User id. */
  sub: string;
  email: string;
}

export function createJwtHelpers(secret: string) {
  const key = new TextEncoder().encode(secret);

  return {
    async signAccessToken(claims: AccessTokenClaims): Promise<string> {
      return new SignJWT({ email: claims.email })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(claims.sub)
        .setIssuer(ISSUER)
        .setAudience(AUDIENCE)
        .setIssuedAt()
        .setExpirationTime(`${ACCESS_TOKEN_TTL_SECONDS}s`)
        .sign(key);
    },

    /** @throws on invalid/expired tokens — callers map this to 401. */
    async verifyAccessToken(token: string): Promise<AccessTokenClaims> {
      const { payload } = await jwtVerify(token, key, { issuer: ISSUER, audience: AUDIENCE });
      if (typeof payload.sub !== 'string' || typeof payload.email !== 'string') {
        throw new Error('Malformed token payload');
      }
      return { sub: payload.sub, email: payload.email };
    },
  };
}

export type JwtHelpers = ReturnType<typeof createJwtHelpers>;
