/**
 * Boundary between Pocketverse and the MTProto client. The connection service
 * only ever talks to this interface; the GramJS adapter implements it and
 * tests substitute a fake. Session strings cross this boundary in plaintext —
 * callers encrypt before persisting and must never log them.
 */

export interface SendCodeResult {
  /** Pre-auth session (DC + auth key) needed to continue the login later. */
  tempSession: string;
  phoneCodeHash: string;
}

export type SignInResult = { kind: 'connected'; session: string } | { kind: 'password_needed' };

export interface StorageChannelInfo {
  channelId: string;
  accessHash: string;
}

export interface UploadFileArgs {
  /** Staged chunk on local disk — streamed, never buffered. */
  path: string;
  fileName: string;
  fileSize: number;
  /** Machine-readable marker, e.g. `pocketverse:{fileId}:{chunkIndex}`. */
  caption: string;
  /** Transfer progress (0..1) — used for honest operator-visible logging. */
  onProgress?: (fraction: number) => void;
}

/** A live download connection; see TelegramGateway.createDownloader. */
export interface Downloader {
  /** Streams one chunk's bytes over the shared connection. */
  downloadChunk(channel: StorageChannelInfo, messageId: string): AsyncIterable<Buffer>;
  close(): Promise<void>;
}

export interface TelegramGateway {
  /** @throws AppError (mapped) on RPC failure */
  sendCode(phone: string): Promise<SendCodeResult>;
  signInWithCode(args: {
    tempSession: string;
    phone: string;
    phoneCodeHash: string;
    code: string;
  }): Promise<SignInResult>;
  signInWithPassword(args: { tempSession: string; password: string }): Promise<{ session: string }>;
  createStorageChannel(session: string): Promise<StorageChannelInfo>;
  /** Resolves when the session works and (if given) the channel is reachable. */
  checkHealth(session: string, channel?: StorageChannelInfo): Promise<void>;
  /** Invalidates the session on the storage side. Best-effort. */
  logOut(session: string): Promise<void>;
  /** Uploads one staged chunk as a channel document. */
  uploadFile(
    session: string,
    channel: StorageChannelInfo,
    args: UploadFileArgs,
  ): Promise<{ messageId: string }>;
  /**
   * Opens ONE connection for a whole download (single file or zip of many)
   * and streams chunks over it. Reusing the connection skips a full
   * connect + handshake per chunk — the dominant dead time on multi-chunk
   * files. Callers MUST close() when done (success or failure).
   */
  createDownloader(session: string): Promise<Downloader>;
  /** Deletes chunk messages for all members; reports how many really went. */
  deleteMessages(
    session: string,
    channel: StorageChannelInfo,
    messageIds: string[],
  ): Promise<{ deletedCount: number }>;
}
