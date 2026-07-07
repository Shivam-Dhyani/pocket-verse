import type { StorageConnection } from '@prisma/client';
import { decryptWithDataKey, type MasterKeyring } from '../../lib/crypto/index.js';
import type { StorageChannelInfo } from '../../lib/telegram/gateway.js';
import { AppError } from '../../middleware/errors.js';

/** AAD binding every connection ciphertext to its owner. */
export function connectionAad(userId: string): string {
  return `user:${userId}:connection`;
}

export const notConnectedError = () =>
  new AppError(400, 'NOT_CONNECTED', 'No storage connection yet. Connect your account first.');

/** Decrypts the live session string. Callers must never log or return it. */
export function decryptConnectionSession(
  connection: StorageConnection,
  keyring: MasterKeyring,
): string {
  if (!connection.encryptedSession) {
    throw notConnectedError();
  }
  return decryptWithDataKey(
    connection.encryptedSession,
    connection.wrappedDataKey,
    keyring,
    connectionAad(connection.userId),
  ).toString('utf8');
}

/** The user's storage channel, or a NOT_CONNECTED error if absent. */
export function requireChannel(connection: StorageConnection): StorageChannelInfo {
  if (!connection.channelId || !connection.channelAccessHash) {
    throw notConnectedError();
  }
  return { channelId: connection.channelId, accessHash: connection.channelAccessHash };
}
