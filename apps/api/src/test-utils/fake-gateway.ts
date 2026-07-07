import { readFile } from 'node:fs/promises';
import type {
  SendCodeResult,
  SignInResult,
  StorageChannelInfo,
  TelegramGateway,
  UploadFileArgs,
} from '../lib/telegram/gateway.js';

/**
 * Scriptable TelegramGateway double. Defaults model the happy path — including
 * an in-memory "channel" that stores uploaded chunk bytes so download tests
 * can verify byte-for-byte round trips. Tests override individual behaviors
 * (2FA required, wrong code, FLOOD_WAIT, failing uploads, …).
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
  /** Called before each stored upload; throw to simulate failures. */
  beforeUpload?: (args: UploadFileArgs, attempt: number) => Promise<void>;
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
  /** messageId → stored chunk bytes ("the channel"). */
  const channelStore = new Map<string, Buffer>();
  let nextMessageId = 1000;
  let uploadAttempts = 0;

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
    async uploadFile(_session, _channel, args) {
      calls.push({ method: 'uploadFile', args: { ...args } });
      uploadAttempts += 1;
      await options.beforeUpload?.(args, uploadAttempts);
      args.onProgress?.(0.5);
      const bytes = await readFile(args.path);
      const messageId = String(nextMessageId++);
      channelStore.set(messageId, bytes);
      args.onProgress?.(1);
      return { messageId };
    },
    async *downloadChunk(_session, _channel, messageId) {
      calls.push({ method: 'downloadChunk', args: { messageId } });
      const bytes = channelStore.get(messageId);
      if (!bytes) {
        throw new Error(`fake channel has no message ${messageId}`);
      }
      // Yield in small pieces to exercise real streaming paths.
      const pieceSize = Math.max(1, Math.ceil(bytes.length / 3));
      for (let start = 0; start < bytes.length; start += pieceSize) {
        yield bytes.subarray(start, start + pieceSize);
      }
    },
    async deleteMessages(_session, _channel, messageIds) {
      calls.push({ method: 'deleteMessages', args: { messageIds } });
      for (const id of messageIds) {
        channelStore.delete(id);
      }
    },
  };

  return { gateway, calls, channelStore };
}
