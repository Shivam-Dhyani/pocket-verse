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
  /** Streams one chunk's bytes back; the iterable owns the connection. */
  downloadChunk(
    session: string,
    channel: StorageChannelInfo,
    messageId: string,
  ): AsyncIterable<Buffer>;
  /** Deletes chunk messages (revoked for all members). */
  deleteMessages(session: string, channel: StorageChannelInfo, messageIds: string[]): Promise<void>;
}
