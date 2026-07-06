import type {
  SendCodeResult,
  SignInResult,
  StorageChannelInfo,
  TelegramGateway,
} from '../lib/telegram/gateway.js';

/**
 * Scriptable TelegramGateway double. Defaults model the happy path; tests
 * override individual behaviors (2FA required, wrong code, FLOOD_WAIT, …).
 */
export interface FakeGatewayOptions {
  requirePassword?: boolean;
  sendCode?: (phone: string) => Promise<SendCodeResult>;
  signInWithCode?: (args: {
    tempSession: string;
    phone: string;
    phoneCodeHash: string;
    code: string;
  }) => Promise<SignInResult>;
  signInWithPassword?: (args: {
    tempSession: string;
    password: string;
  }) => Promise<{ session: string }>;
  createStorageChannel?: (session: string) => Promise<StorageChannelInfo>;
  checkHealth?: (session: string, channel?: StorageChannelInfo) => Promise<void>;
  logOut?: (session: string) => Promise<void>;
}

export const FAKE_TEMP_SESSION = 'fake-temp-session-string';
export const FAKE_FINAL_SESSION = 'fake-final-session-string-full-account-access';
export const FAKE_CODE_HASH = 'fake-phone-code-hash';
export const FAKE_CHANNEL: StorageChannelInfo = {
  channelId: '2001234567',
  accessHash: '8811223344556677',
};

export function createFakeGateway(options: FakeGatewayOptions = {}) {
  const calls: { method: string; args: unknown }[] = [];

  const gateway: TelegramGateway = {
    async sendCode(phone) {
      calls.push({ method: 'sendCode', args: { phone } });
      if (options.sendCode) {
        return options.sendCode(phone);
      }
      return { tempSession: FAKE_TEMP_SESSION, phoneCodeHash: FAKE_CODE_HASH };
    },
    async signInWithCode(args) {
      calls.push({ method: 'signInWithCode', args });
      if (options.signInWithCode) {
        return options.signInWithCode(args);
      }
      if (options.requirePassword) {
        return { kind: 'password_needed' };
      }
      return { kind: 'connected', session: FAKE_FINAL_SESSION };
    },
    async signInWithPassword(args) {
      calls.push({ method: 'signInWithPassword', args });
      if (options.signInWithPassword) {
        return options.signInWithPassword(args);
      }
      return { session: FAKE_FINAL_SESSION };
    },
    async createStorageChannel(session) {
      calls.push({ method: 'createStorageChannel', args: { session } });
      if (options.createStorageChannel) {
        return options.createStorageChannel(session);
      }
      return { ...FAKE_CHANNEL };
    },
    async checkHealth(session, channel) {
      calls.push({ method: 'checkHealth', args: { session, channel } });
      if (options.checkHealth) {
        return options.checkHealth(session, channel);
      }
    },
    async logOut(session) {
      calls.push({ method: 'logOut', args: { session } });
      if (options.logOut) {
        return options.logOut(session);
      }
    },
  };

  return { gateway, calls };
}
