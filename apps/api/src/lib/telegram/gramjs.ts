import { createHash } from 'node:crypto';
import { Api, TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { computeCheck } from 'telegram/Password.js';
import { Logger, LogLevel } from 'telegram/extensions/Logger.js';
import { CustomFile } from 'telegram/client/uploads.js';
import bigInt from 'big-integer';
import { AppError } from '../../middleware/errors.js';
import type {
  SendCodeResult,
  SignInResult,
  StorageChannelInfo,
  TelegramGateway,
  UploadFileArgs,
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

/**
 * How long a warm transfer connection stays open after its last use. Long
 * enough to span the gaps between files in a folder upload, short enough that
 * idle accounts don't hold sockets.
 */
const WARM_IDLE_MS = 60_000;

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
   * Warm transfer connections, one per session. Setting up a connection is the
   * expensive part of a small upload: TCP to the account's data centre, the
   * MTProto init + config fetch, then a second connection GramJS opens just for
   * file parts — several round trips before any byte moves. Paying that once
   * per FILE made a 3-image folder slow; now consecutive uploads (and deletes)
   * for an account share one connection, and GramJS keeps its upload
   * connection open between them too.
   *
   * Keyed by a hash of the session (a reconnected account gets a fresh entry).
   * A connection that fails an operation is dropped, so the retry reconnects
   * cleanly. Calls for one account are already serialized by the worker's
   * per-user lock (ADR-0003), so a connection is rarely shared concurrently —
   * but reference counting keeps that safe if it is.
   */
  interface WarmClient {
    client: TelegramClient;
    ready: Promise<void>;
    /** Set once `ready` resolves — distinguishes "still connecting" from "socket died". */
    open: boolean;
    inUse: number;
    retired: boolean;
    idleTimer?: NodeJS.Timeout;
  }
  const warm = new Map<string, WarmClient>();

  const warmKey = (session: string) => createHash('sha256').update(session).digest('hex');

  /** Drop from the pool now; close the socket once nothing is using it. */
  function retire(key: string, entry: WarmClient): void {
    entry.retired = true;
    if (warm.get(key) === entry) {
      warm.delete(key);
    }
    clearTimeout(entry.idleTimer);
    if (entry.inUse === 0) {
      void entry.client.destroy().catch(() => undefined);
    }
  }

  /** A connected client for this session — reused when warm, opened if not. */
  async function acquireWarm(
    session: string,
  ): Promise<{ client: TelegramClient; reused: boolean; release: (failed: boolean) => void }> {
    const key = warmKey(session);
    let entry = warm.get(key);
    // A connect still in flight is fine (awaited below). A connection that was
    // open but whose socket has since dropped is not — start over.
    if (entry && entry.open && !entry.client.connected) {
      retire(key, entry);
      entry = undefined;
    }
    const reused = Boolean(entry);
    if (!entry) {
      const client = newClient(session);
      const created: WarmClient = {
        client,
        open: false,
        inUse: 0,
        retired: false,
        ready: withTimeout(async () => {
          await client.connect();
        }),
      };
      created.ready.then(
        () => {
          created.open = true;
        },
        // An unobserved rejection (e.g. a failed prewarm) must not crash Node.
        () => undefined,
      );
      warm.set(key, created);
      entry = created;
    }
    const held = entry;
    clearTimeout(held.idleTimer);
    held.inUse += 1;
    try {
      await held.ready;
    } catch (error) {
      held.inUse -= 1;
      retire(key, held);
      throw mapTelegramError(error);
    }
    return {
      client: held.client,
      reused,
      release(failed) {
        held.inUse -= 1;
        if (failed || held.retired) {
          retire(key, held);
          return;
        }
        if (held.inUse === 0) {
          held.idleTimer = setTimeout(() => retire(key, held), WARM_IDLE_MS);
          held.idleTimer.unref();
        }
      },
    };
  }

  /**
   * One connected client per operation: connect → run → always disconnect,
   * all under a hard timeout. Used for the infrequent account-level calls
   * (login, health checks, channel creation, log out); transfers use the warm
   * pool above.
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
      // The session dies with the log-out — any warm connection on it too.
      const key = warmKey(session);
      const entry = warm.get(key);
      if (entry) {
        retire(key, entry);
      }
      await withClient(session, async (client) => {
        await client.invoke(new Api.auth.LogOut());
      });
    },

    async uploadFile(
      session: string,
      channel: StorageChannelInfo,
      args: UploadFileArgs,
    ): Promise<{ messageId: string; reusedConnection: boolean }> {
      // Connection setup is bounded by withTimeout inside acquireWarm. The
      // transfer itself isn't — a 1.5GB chunk legitimately takes longer than
      // any sane fixed ceiling. GramJS streams the file from disk in parts.
      const { client, reused, release } = await acquireWarm(session);
      let failed = false;
      try {
        const message = await withFloodWait(() =>
          client.sendFile(channelPeer(channel), {
            file: new CustomFile(args.fileName, args.fileSize, args.path),
            caption: args.caption,
            forceDocument: true,
            // Parallel in-flight file parts — the default single worker
            // crawls (~1MB/s) on big files.
            workers: 8,
            progressCallback: args.onProgress
              ? (progress) => args.onProgress?.(Number(progress))
              : undefined,
          }),
        );
        return { messageId: String(message.id), reusedConnection: reused };
      } catch (error) {
        failed = true;
        throw mapTelegramError(error);
      } finally {
        release(failed);
      }
    },

    prewarm(session: string): void {
      void acquireWarm(session).then(
        ({ release }) => release(false),
        () => undefined, // best-effort: the upload itself will connect and report
      );
    },

    async close(): Promise<void> {
      for (const [key, entry] of [...warm]) {
        entry.inUse = 0;
        retire(key, entry);
      }
    },

    async createDownloader(session: string) {
      // ONE connection for the whole download — connect (and handshake) once,
      // then every chunk of every file rides the same client. close() is the
      // caller's responsibility, success or failure.
      const client = newClient(session);
      try {
        await withTimeout(async () => client.connect());
      } catch (error) {
        void client.destroy().catch(() => undefined);
        throw mapTelegramError(error);
      }

      return {
        async verifyPresent(
          channel: StorageChannelInfo,
          messageIds: string[],
        ): Promise<{ missingIds: string[] }> {
          try {
            const ids = messageIds.map(Number);
            // One lookup for every chunk of the file. getMessages returns a
            // list aligned to the requested ids; a deleted message comes back
            // as an empty message with no media.
            const messages = await withTimeout(() =>
              withFloodWait(async () => client.getMessages(channelPeer(channel), { ids })),
            );
            const missingIds = ids
              .filter((_id, index) => !messages[index]?.media)
              .map((id) => String(id));
            return { missingIds };
          } catch (error) {
            throw mapTelegramError(error);
          }
        },
        async *downloadChunk(
          channel: StorageChannelInfo,
          messageId: string,
        ): AsyncIterable<Buffer> {
          try {
            // Locate the message under the standard timeout…
            const media = await withTimeout(() =>
              withFloodWait(async () => {
                const [message] = await client.getMessages(channelPeer(channel), {
                  ids: [Number(messageId)],
                });
                if (!message?.media) {
                  throw new AppError(
                    404,
                    'CHUNK_MISSING',
                    'Part of this file is missing from your storage. It may have been deleted there.',
                  );
                }
                return message.media;
              }),
            );

            // …then stream without a fixed ceiling — size is unbounded.
            for await (const piece of client.iterDownload({
              file: media,
              requestSize: 512 * 1024,
            })) {
              yield piece as Buffer;
            }
          } catch (error) {
            throw mapTelegramError(error);
          }
        },
        async close() {
          await client.destroy().catch(() => undefined);
        },
      };
    },

    async deleteMessages(
      session: string,
      channel: StorageChannelInfo,
      messageIds: string[],
    ): Promise<{ deletedCount: number }> {
      // Folder deletes enqueue many batches back to back — same warm connection.
      const { client, release } = await acquireWarm(session);
      let failed = false;
      try {
        return await withTimeout(async () => {
          // Explicit channel deletion (deletes for all members) — the high-level
          // client.deleteMessages() convenience routes by entity type and has
          // silently no-oped for some setups.
          const result = await withFloodWait(() =>
            client.invoke(
              new Api.channels.DeleteMessages({
                channel: channelPeer(channel),
                id: messageIds.map(Number),
              }),
            ),
          );
          return { deletedCount: result.ptsCount };
        });
      } catch (error) {
        failed = true;
        throw mapTelegramError(error);
      } finally {
        release(failed);
      }
    },
  };
}

function channelPeer(channel: StorageChannelInfo): Api.InputPeerChannel {
  return new Api.InputPeerChannel({
    channelId: bigInt(channel.channelId),
    accessHash: bigInt(channel.accessHash),
  });
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
