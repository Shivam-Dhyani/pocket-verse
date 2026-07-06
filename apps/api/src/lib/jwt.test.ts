import { describe, expect, it } from 'vitest';
import { createJwtHelpers } from './jwt.js';

const secret = 'test-secret-at-least-32-characters-long!!';
const jwt = createJwtHelpers(secret);

describe('jwt helpers', () => {
  it('signs and verifies an access token round trip', async () => {
    const token = await jwt.signAccessToken({ sub: 'user_1', email: 'a@b.co' });
    const claims = await jwt.verifyAccessToken(token);
    expect(claims).toEqual({ sub: 'user_1', email: 'a@b.co' });
  });

  it('rejects a token signed with a different secret', async () => {
    const other = createJwtHelpers('another-secret-also-32-characters-long!');
    const token = await other.signAccessToken({ sub: 'user_1', email: 'a@b.co' });
    await expect(jwt.verifyAccessToken(token)).rejects.toThrow();
  });

  it('rejects garbage tokens', async () => {
    await expect(jwt.verifyAccessToken('not.a.jwt')).rejects.toThrow();
  });
});
