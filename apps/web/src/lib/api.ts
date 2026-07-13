import type { AuthResponse, LoginInput, RegisterInput, UserDto } from '@pocketverse/shared';
import { useAuthStore } from '@/stores/auth';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  auth?: boolean;
  /** internal: prevents infinite refresh loops */
  _retried?: boolean;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { accessToken } = useAuthStore.getState();

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: options.method ?? 'GET',
      credentials: 'include',
      headers: {
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(options.auth && accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });
  } catch {
    // fetch() itself failed — the server is down or unreachable, not an HTTP error.
    throw new ApiError(
      0,
      'NETWORK',
      "Can't reach the server. Check that the API is running, then try again.",
    );
  }

  if (res.status === 204) {
    return undefined as T;
  }

  const payload = (await res.json().catch(() => null)) as {
    error?: { code?: string; message?: string };
  } | null;

  if (!res.ok) {
    // Expired access token → try one silent refresh, then replay the request.
    if (res.status === 401 && options.auth && !options._retried) {
      const refreshed = await tryRefresh();
      if (refreshed) {
        return request<T>(path, { ...options, _retried: true });
      }
      useAuthStore.getState().clearSession();
    }
    throw new ApiError(
      res.status,
      payload?.error?.code ?? 'UNKNOWN',
      payload?.error?.message ?? 'Something went wrong. Please try again.',
    );
  }

  return payload as T;
}

/**
 * Token-attaching fetch for non-JSON traffic (raw part uploads, downloads).
 * Retries once after a silent refresh on 401, like request().
 */
export async function apiFetch(
  path: string,
  init: RequestInit = {},
  _retried = false,
): Promise<Response> {
  const { accessToken } = useAuthStore.getState();
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      credentials: 'include',
      ...init,
      headers: {
        ...(init.headers ?? {}),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
    });
  } catch {
    throw new ApiError(
      0,
      'NETWORK',
      "Can't reach the server. Check that the API is running, then try again.",
    );
  }
  if (res.status === 401 && !_retried && (await tryRefresh())) {
    return apiFetch(path, init, true);
  }
  return res;
}

async function tryRefresh(): Promise<boolean> {
  try {
    const result = await request<AuthResponse>('/api/auth/refresh', { method: 'POST' });
    useAuthStore.getState().setSession(result);
    return true;
  } catch {
    return false;
  }
}

export const api = {
  register: (input: RegisterInput) =>
    request<AuthResponse>('/api/auth/register', { method: 'POST', body: input }),
  login: (input: LoginInput) =>
    request<AuthResponse>('/api/auth/login', { method: 'POST', body: input }),
  refresh: tryRefresh,
  logout: () => request<void>('/api/auth/logout', { method: 'POST' }),
  me: () => request<{ user: UserDto }>('/api/auth/me', { auth: true }),
  changePassword: (input: { currentPassword: string; newPassword: string }) =>
    request<void>('/api/auth/change-password', { method: 'POST', auth: true, body: input }),
  forgotPassword: (email: string) =>
    request<void>('/api/auth/forgot-password', { method: 'POST', body: { email } }),
  resetPassword: (input: { token: string; password: string }) =>
    request<void>('/api/auth/reset-password', { method: 'POST', body: input }),
};
