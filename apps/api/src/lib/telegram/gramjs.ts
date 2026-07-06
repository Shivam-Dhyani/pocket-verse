import { Api, TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { computeCheck } from 'telegram/Password.js';
import { Logger, LogLevel } from 'telegram/extensions/Logger.js';
import bigInt from 'big-integer';
import { AppError } from '../../middleware/errors.js';
import type {
  SendCodeResult,
  SignInResult,
  StorageChannelInfo,
  TelegramGateway,
} from './gateway.js';
import { floodWaitError, isFloodWait, mapTelegramError } from './errors.js';

export interface GramjsGatewayConfig {
  apiId: number;
  apiHash: string;
}

const STORAGE_CHANNEL_TITLE = 'Pocketverse Storage';
const STORAGE_CHANNEL_ABOUT =
  'Private channel created by Pocketverse to hold your files. Do not delete.';

/** FLOOD_WAITs up to this long are absorbed by waiting; longer ones become 429s. */
const MAX_INLINE_FLOOD_WAIT_SECONDS = 15;

/** Hard ceiling per operation — a wedged DC connection must not hang requests. */
const OPERATION_TIMEOUT_MS = 45_000;

const timeoutError = () =>
  new AppError(
    504,
    'STORAGE_TIMEOUT',
    'Your storage is taking too long to respond. Nothing was lost — try again shortly.',
  );

export function createGramjsGateway(config: GramjsGatewayConfig): TelegramGateway {
  function newClient(session: string): TelegramClient {
    return new TelegramClient(new StringSession(session), config.apiId, config.apiHash, {
      connectionRetries: 3,
      // GramJS's default logger prints to stdout unredacted — keep it silent.
      baseLogger: new Logger(LogLevel.NONE),
    });
  }

  /**
   * One connected client per operation: connect → run → always disconnect,
   * all under a hard timeout. Free-tier dynos sleep; long-lived sockets buy
   * nothing here yet.
   */
  async function withClient<T>(
    session: string,
    fn: (client: TelegramClient) => Promise<T>,
  ): Promise<T> {
    const client = newClient(session);
    try {
      return await withTimeout(async () => {
        await client.connect();
        return withFloodWait(() => fn(client));
      });
    } catch (error) {
      throw mapTelegramError(error);
    } finally {
      void client.destroy().catch(() => undefined);
    }
  }

  return {
    async sendCode(phone: string): Promise<SendCodeResult> {
      return withClient('', async (client) => {
        const sent = await client.sendCode({ apiId: config.apiId, apiHash: config.apiHash }, phone);
        return {
          tempSession: client.session.save() as unknown as string,
          phoneCodeHash: sent.phoneCodeHash,
        };
      });
    },

    async signInWithCode({ tempSession, phone, phoneCodeHash, code }): Promise<SignInResult> {
      const client = newClient(tempSession);
      try {
        return await withTimeout(async () => {
          await client.connect();
          await withFloodWait(() =>
            client.invoke(
              new Api.auth.SignIn({ phoneNumber: phone, phoneCodeHash, phoneCode: code }),
            ),
          );
          return {
            kind: 'connected' as const,
            session: client.session.save() as unknown as string,
          };
        });
      } catch (error) {
        if ((error as { errorMessage?: string })?.errorMessage === 'SESSION_PASSWORD_NEEDED') {
          // Flow control, not failure: the account has 2FA enabled.
          return { kind: 'password_needed' };
        }
        throw mapTelegramError(error);
      } finally {
        void client.destroy().catch(() => undefined);
      }
    },

    async signInWithPassword({ tempSession, password }): Promise<{ session: string }> {
      return withClient(tempSession, async (client) => {
        const passwordInfo = await client.invoke(new Api.account.GetPassword());
        const srpCheck = await computeCheck(passwordInfo, password);
        await client.invoke(new Api.auth.CheckPassword({ password: srpCheck }));
        return { session: client.session.save() as unknown as string };
      });
    },

    async createStorageChannel(session: string): Promise<StorageChannelInfo> {
      return withClient(session, async (client) => {
        const result = await client.invoke(
          new Api.channels.CreateChannel({
            title: STORAGE_CHANNEL_TITLE,
            about: STORAGE_CHANNEL_ABOUT,
            broadcast: true,
            megagroup: false,
          }),
        );
        const updates = result as Api.Updates;
        const channel = updates.chats?.find(
          (chat): chat is Api.Channel => chat instanceof Api.Channel,
        );
        if (!channel || channel.accessHash === undefined) {
          throw new Error('Channel creation returned no channel');
        }
        return { channelId: channel.id.toString(), accessHash: channel.accessHash.toString() };
      });
    },

    async checkHealth(session: string, channel?: StorageChannelInfo): Promise<void> {
      await withClient(session, async (client) => {
        await client.getMe();
        if (channel) {
          await client.invoke(
            new Api.channels.GetChannels({
              id: [
                new Api.InputChannel({
                  channelId: bigInt(channel.channelId),
                  accessHash: bigInt(channel.accessHash),
                }),
              ],
            }),
          );
        }
      });
    },

    async logOut(session: string): Promise<void> {
      await withClient(session, async (client) => {
        await client.invoke(new Api.auth.LogOut());
      });
    },
  };
}

/** Absorb short FLOOD_WAITs with a single wait-and-retry; surface long ones. */
export async function withFloodWait<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (isFloodWait(error)) {
      if (error.seconds <= MAX_INLINE_FLOOD_WAIT_SECONDS) {
        await sleep((error.seconds + 1) * 1000);
        return fn();
      }
      throw floodWaitError(error.seconds);
    }
    throw error;
  }
}

async function withTimeout<T>(fn: () => Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(timeoutError()), OPERATION_TIMEOUT_MS);
  });
  try {
    return await Promise.race([fn(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
