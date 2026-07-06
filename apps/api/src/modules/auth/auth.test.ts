import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createTestApp } from '../../test-utils/test-app.js';

const EMAIL = 'astro@example.com';
const PASSWORD = 'orbit-around-9-planets';

function extractRefreshCookie(res: request.Response): string {
  const cookies = res.get('Set-Cookie') ?? [];
  const cookie = cookies.find((c) => c.startsWith('pv_refresh='));
  expect(cookie, 'expected a pv_refresh cookie').toBeDefined();
  return (cookie as string).split(';')[0] as string;
}

describe('POST /api/auth/register', () => {
  it('creates an account and returns tokens', async () => {
    const { app } = createTestApp();
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: EMAIL, password: PASSWORD });

    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe(EMAIL);
    expect(res.body.accessToken).toBeTypeOf('string');
    expect(res.body).not.toHaveProperty('user.passwordHash');

    const cookie = extractRefreshCookie(res);
    expect(cookie.length).toBeGreaterThan('pv_refresh='.length + 40);
    const rawCookieHeader = (res.get('Set-Cookie') ?? []).join(';');
    expect(rawCookieHeader).toContain('HttpOnly');
    expect(rawCookieHeader).toContain('SameSite=Strict');
  });

  it('normalizes the email (trim + lowercase)', async () => {
    const { app } = createTestApp();
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: '  Astro@Example.COM ', password: PASSWORD });
    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe(EMAIL);
  });

  it('rejects a duplicate email with 409', async () => {
    const { app } = createTestApp();
    await request(app).post('/api/auth/register').send({ email: EMAIL, password: PASSWORD });
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: EMAIL, password: PASSWORD });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('rejects invalid input with field-level details', async () => {
    const { app } = createTestApp();
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'not-an-email', password: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
    const paths = res.body.error.details.map((d: { path: string }) => d.path);
    expect(paths).toContain('email');
    expect(paths).toContain('password');
  });

  it('never stores the plaintext password', async () => {
    const { app, prisma } = createTestApp();
    await request(app).post('/api/auth/register').send({ email: EMAIL, password: PASSWORD });
    const [user] = [...prisma._state.users.values()];
    expect(user?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(user?.passwordHash).not.toContain(PASSWORD);
  });
});

describe('POST /api/auth/login', () => {
  it('logs in with correct credentials', async () => {
    const { app } = createTestApp();
    await request(app).post('/api/auth/register').send({ email: EMAIL, password: PASSWORD });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: EMAIL, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTypeOf('string');
  });

  it('returns the same 401 for wrong password and unknown email', async () => {
    const { app } = createTestApp();
    await request(app).post('/api/auth/register').send({ email: EMAIL, password: PASSWORD });

    const wrongPassword = await request(app)
      .post('/api/auth/login')
      .send({ email: EMAIL, password: 'totally-wrong-password' });
    const unknownEmail = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ghost@example.com', password: PASSWORD });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body).toEqual(unknownEmail.body);
  });
});

describe('GET /api/auth/me', () => {
  it('returns the current user with a valid token', async () => {
    const { app } = createTestApp();
    const register = await request(app)
      .post('/api/auth/register')
      .send({ email: EMAIL, password: PASSWORD });

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${register.body.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(EMAIL);
  });

  it('rejects missing and invalid tokens', async () => {
    const { app } = createTestApp();
    expect((await request(app).get('/api/auth/me')).status).toBe(401);
    expect(
      (await request(app).get('/api/auth/me').set('Authorization', 'Bearer nope')).status,
    ).toBe(401);
  });
});

describe('POST /api/auth/refresh', () => {
  it('rotates the refresh token', async () => {
    const { app } = createTestApp();
    const register = await request(app)
      .post('/api/auth/register')
      .send({ email: EMAIL, password: PASSWORD });
    const firstCookie = extractRefreshCookie(register);

    const refresh = await request(app).post('/api/auth/refresh').set('Cookie', firstCookie);
    expect(refresh.status).toBe(200);
    expect(refresh.body.accessToken).toBeTypeOf('string');

    const secondCookie = extractRefreshCookie(refresh);
    expect(secondCookie).not.toBe(firstCookie);
  });

  it('rejects a reused (rotated) token and revokes all sessions', async () => {
    const { app } = createTestApp();
    const register = await request(app)
      .post('/api/auth/register')
      .send({ email: EMAIL, password: PASSWORD });
    const firstCookie = extractRefreshCookie(register);

    const refresh = await request(app).post('/api/auth/refresh').set('Cookie', firstCookie);
    const secondCookie = extractRefreshCookie(refresh);

    // Replay of the rotated token → reuse detection.
    const replay = await request(app).post('/api/auth/refresh').set('Cookie', firstCookie);
    expect(replay.status).toBe(401);

    // Reuse detection revoked the whole family, including the newest token.
    const after = await request(app).post('/api/auth/refresh').set('Cookie', secondCookie);
    expect(after.status).toBe(401);
  });

  it('rejects a request without a cookie', async () => {
    const { app } = createTestApp();
    expect((await request(app).post('/api/auth/refresh')).status).toBe(401);
  });
});

describe('POST /api/auth/logout', () => {
  it('revokes the refresh token and clears the cookie', async () => {
    const { app } = createTestApp();
    const register = await request(app)
      .post('/api/auth/register')
      .send({ email: EMAIL, password: PASSWORD });
    const cookie = extractRefreshCookie(register);

    const logout = await request(app).post('/api/auth/logout').set('Cookie', cookie);
    expect(logout.status).toBe(204);

    const refresh = await request(app).post('/api/auth/refresh').set('Cookie', cookie);
    expect(refresh.status).toBe(401);
  });
});

describe('hardening basics', () => {
  it('serves a health check', async () => {
    const { app } = createTestApp();
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('404s unknown routes with a JSON error', async () => {
    const { app } = createTestApp();
    const res = await request(app).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('does not expose x-powered-by', async () => {
    const { app } = createTestApp();
    const res = await request(app).get('/health');
    expect(res.get('x-powered-by')).toBeUndefined();
  });
});
