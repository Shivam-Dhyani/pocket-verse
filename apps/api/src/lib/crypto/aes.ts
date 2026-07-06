import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { DecryptionError, InvalidPayloadError } from './errors.js';

/**
 * AES-256-GCM primitives.
 *
 * Encrypted values are stored as a compact, versioned string:
 *
 *   plain value:   "v1.<iv>.<tag>.<ciphertext>"
 *   wrapped key:   "v1.<keyId>.<iv>.<tag>.<ciphertext>"
 *
 * Segments are base64url (never contain "."); keyId is [A-Za-z0-9_-]+ so the
 * two shapes are distinguished purely by segment count. The version prefix
 * lets us migrate formats without guessing.
 */

const VERSION = 'v1';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export type EncryptedString = string;

export interface ParsedPayload {
  version: string;
  keyId?: string;
  iv: Buffer;
  tag: Buffer;
  ciphertext: Buffer;
}

export function assertValidKey(key: Buffer): void {
  if (key.length !== KEY_BYTES) {
    throw new InvalidPayloadError();
  }
}

export function assertValidKeyId(keyId: string): void {
  if (!KEY_ID_PATTERN.test(keyId)) {
    throw new InvalidPayloadError();
  }
}

/** 32 cryptographically random bytes — a fresh AES-256 data key. */
export function generateDataKey(): Buffer {
  return randomBytes(KEY_BYTES);
}

export function encrypt(
  plaintext: Buffer | string,
  key: Buffer,
  options: { aad?: string; keyId?: string } = {},
): EncryptedString {
  assertValidKey(key);
  if (options.keyId !== undefined) {
    assertValidKeyId(options.keyId);
  }

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  if (options.aad) {
    cipher.setAAD(Buffer.from(options.aad, 'utf8'));
  }

  const input = typeof plaintext === 'string' ? Buffer.from(plaintext, 'utf8') : plaintext;
  const ciphertext = Buffer.concat([cipher.update(input), cipher.final()]);
  const tag = cipher.getAuthTag();

  const segments = [
    VERSION,
    ...(options.keyId !== undefined ? [options.keyId] : []),
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ];
  return segments.join('.');
}

export function parsePayload(payload: EncryptedString): ParsedPayload {
  if (typeof payload !== 'string') {
    throw new InvalidPayloadError();
  }
  const segments = payload.split('.');
  if (segments.length !== 4 && segments.length !== 5) {
    throw new InvalidPayloadError();
  }

  const [version, ...rest] = segments;
  if (version !== VERSION) {
    throw new InvalidPayloadError();
  }

  const keyId = segments.length === 5 ? rest.shift() : undefined;
  if (keyId !== undefined && !KEY_ID_PATTERN.test(keyId)) {
    throw new InvalidPayloadError();
  }

  const [ivB64, tagB64, ciphertextB64] = rest as [string, string, string];
  const iv = Buffer.from(ivB64, 'base64url');
  const tag = Buffer.from(tagB64, 'base64url');
  const ciphertext = Buffer.from(ciphertextB64, 'base64url');

  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new InvalidPayloadError();
  }

  return { version, keyId, iv, tag, ciphertext };
}

export function decrypt(
  payload: EncryptedString,
  key: Buffer,
  options: { aad?: string } = {},
): Buffer {
  assertValidKey(key);
  const { iv, tag, ciphertext } = parsePayload(payload);

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  if (options.aad) {
    decipher.setAAD(Buffer.from(options.aad, 'utf8'));
  }
  decipher.setAuthTag(tag);

  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    // Deliberately constant: never surface why authentication failed.
    throw new DecryptionError();
  }
}
