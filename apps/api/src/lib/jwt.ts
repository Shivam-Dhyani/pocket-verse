import { SignJWT, jwtVerify } from 'jose';
import { ACCESS_TOKEN_TTL_SECONDS } from '../config/env.js';

const ISSUER = 'pocketverse';
const AUDIENCE = 'pocketverse:web';
const DOWNLOAD_AUDIENCE = 'pocketverse:download';
const DOWNLOAD_TOKEN_TTL = '5m';

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

    /**
     * Short-lived, single-file token so downloads can run as plain browser
     * navigations (native download UI) instead of authorized fetches.
     */
    async signDownloadToken(userId: string, fileId: string): Promise<string> {
      return new SignJWT({ fileId })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(userId)
        .setIssuer(ISSUER)
        .setAudience(DOWNLOAD_AUDIENCE)
        .setIssuedAt()
        .setExpirationTime(DOWNLOAD_TOKEN_TTL)
        .sign(key);
    },

    /** @throws on invalid/expired tokens. */
    async verifyDownloadToken(token: string): Promise<{ sub: string; fileId: string }> {
      const { payload } = await jwtVerify(token, key, {
        issuer: ISSUER,
        audience: DOWNLOAD_AUDIENCE,
      });
      if (typeof payload.sub !== 'string' || typeof payload.fileId !== 'string') {
        throw new Error('Malformed token payload');
      }
      return { sub: payload.sub, fileId: payload.fileId };
    },
  };
}

export type JwtHelpers = ReturnType<typeof createJwtHelpers>;
