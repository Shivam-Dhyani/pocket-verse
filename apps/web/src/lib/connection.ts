import type {
  ConnectionDto,
  StartConnectionInput,
  VerifyCodeInput,
  VerifyPasswordInput,
} from '@pocketverse/shared';
import { request } from '@/lib/api';

export const connectionApi = {
  status: () => request<{ connection: ConnectionDto }>('/api/connection', { auth: true }),
  start: (input: StartConnectionInput) =>
    request<{ connection: ConnectionDto }>('/api/connection/start', {
      method: 'POST',
      body: input,
      auth: true,
    }),
  verifyCode: (input: VerifyCodeInput) =>
    request<{ connection: ConnectionDto }>('/api/connection/verify-code', {
      method: 'POST',
      body: input,
      auth: true,
    }),
  verifyPassword: (input: VerifyPasswordInput) =>
    request<{ connection: ConnectionDto }>('/api/connection/verify-password', {
      method: 'POST',
      body: input,
      auth: true,
    }),
  check: () =>
    request<{ connection: ConnectionDto }>('/api/connection/check', {
      method: 'POST',
      auth: true,
    }),
  disconnect: () => request<void>('/api/connection', { method: 'DELETE', auth: true }),
  revealPhone: () => request<{ phone: string }>('/api/connection/phone', { auth: true }),
};
