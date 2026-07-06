import type { EncryptedString } from './aes.js';
import { decrypt, encrypt, generateDataKey, parsePayload } from './aes.js';
import { InvalidPayloadError } from './errors.js';
import type { MasterKeyring } from './keyring.js';

/**
 * Envelope encryption:
 *
 *   master key (env keyring) ──wraps──▶ per-user data key ──encrypts──▶ payload
 *
 * The wrapped data key embeds the master key id it was wrapped with, so the
 * keyring can hold old + new keys simultaneously during rotation.
 *
 * Every operation takes an AAD string (e.g. `user:{userId}:session`) that
 * cryptographically binds ciphertexts to their context: a value copied into
 * another user's row fails authentication instead of decrypting.
 */

export function createWrappedDataKey(
  keyring: MasterKeyring,
  aad: string,
): { wrappedKey: EncryptedString } {
  const dataKey = generateDataKey();
  try {
    return { wrappedKey: wrapDataKey(dataKey, keyring, aad) };
  } finally {
    dataKey.fill(0);
  }
}

export function unwrapDataKey(
  wrappedKey: EncryptedString,
  keyring: MasterKeyring,
  aad: string,
): Buffer {
  const { keyId } = parsePayload(wrappedKey);
  if (keyId === undefined) {
    throw new InvalidPayloadError();
  }
  return decrypt(wrappedKey, keyring.getKey(keyId), { aad });
}

export function encryptWithDataKey(
  plaintext: Buffer | string,
  wrappedKey: EncryptedString,
  keyring: MasterKeyring,
  aad: string,
): EncryptedString {
  const dataKey = unwrapDataKey(wrappedKey, keyring, aad);
  try {
    return encrypt(plaintext, dataKey, { aad });
  } finally {
    dataKey.fill(0);
  }
}

export function decryptWithDataKey(
  ciphertext: EncryptedString,
  wrappedKey: EncryptedString,
  keyring: MasterKeyring,
  aad: string,
): Buffer {
  const dataKey = unwrapDataKey(wrappedKey, keyring, aad);
  try {
    return decrypt(ciphertext, dataKey, { aad });
  } finally {
    dataKey.fill(0);
  }
}

/**
 * Rotation: unwrap with whichever key id the value carries, re-wrap with the
 * keyring's active key. Run over all stored wrapped keys after adding a new
 * master key, then the old master key can be dropped from MASTER_KEYS.
 */
export function rewrapDataKey(
  wrappedKey: EncryptedString,
  keyring: MasterKeyring,
  aad: string,
): EncryptedString {
  const dataKey = unwrapDataKey(wrappedKey, keyring, aad);
  try {
    return wrapDataKey(dataKey, keyring, aad);
  } finally {
    dataKey.fill(0);
  }
}

function wrapDataKey(dataKey: Buffer, keyring: MasterKeyring, aad: string): EncryptedString {
  return encrypt(dataKey, keyring.getKey(keyring.activeKeyId), {
    aad,
    keyId: keyring.activeKeyId,
  });
}
