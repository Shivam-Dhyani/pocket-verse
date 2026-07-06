import { randomBytes, timingSafeEqual } from 'node:crypto';
import { KeyringConfigError, UnknownKeyIdError } from './errors.js';

/**
 * Master keyring for envelope encryption.
 *
 * Env format:
 *   MASTER_KEYS="k1:<base64 32B>[,k2:<base64 32B>...]"
 *   MASTER_KEY_ACTIVE="k1"
 *
 * Multiple keys make rotation possible: add a new key, flip the active id,
 * re-wrap stored data keys (see rewrapDataKey), then remove the old key.
 */

const KEY_BYTES = 32;
const KEY_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export interface MasterKeyring {
  readonly activeKeyId: string;
  /** @throws UnknownKeyIdError */
  getKey(keyId: string): Buffer;
  hasKey(keyId: string): boolean;
}

export interface KeyringEnv {
  MASTER_KEYS: string;
  MASTER_KEY_ACTIVE: string;
}

export function loadMasterKeyring(env: KeyringEnv): MasterKeyring {
  const raw = env.MASTER_KEYS?.trim();
  const activeKeyId = env.MASTER_KEY_ACTIVE?.trim();

  if (!raw) {
    throw new KeyringConfigError('MASTER_KEYS is not set');
  }
  if (!activeKeyId) {
    throw new KeyringConfigError('MASTER_KEY_ACTIVE is not set');
  }

  const keys = new Map<string, Buffer>();
  for (const entry of raw.split(',')) {
    const separator = entry.indexOf(':');
    if (separator === -1) {
      throw new KeyringConfigError('MASTER_KEYS entry is malformed (expected keyId:base64Key)');
    }
    const keyId = entry.slice(0, separator).trim();
    const keyB64 = entry.slice(separator + 1).trim();

    if (!KEY_ID_PATTERN.test(keyId)) {
      throw new KeyringConfigError('MASTER_KEYS key id must match [A-Za-z0-9_-]+');
    }
    if (keys.has(keyId)) {
      throw new KeyringConfigError('MASTER_KEYS contains a duplicate key id');
    }

    const key = Buffer.from(keyB64, 'base64');
    if (key.length !== KEY_BYTES || key.toString('base64') !== normalizeBase64(keyB64)) {
      throw new KeyringConfigError('MASTER_KEYS key must be exactly 32 base64-encoded bytes');
    }
    keys.set(keyId, key);
  }

  if (!keys.has(activeKeyId)) {
    throw new KeyringConfigError('MASTER_KEY_ACTIVE does not match any key in MASTER_KEYS');
  }

  return {
    activeKeyId,
    getKey(keyId: string): Buffer {
      const key = keys.get(keyId);
      if (!key) {
        throw new UnknownKeyIdError();
      }
      return key;
    },
    hasKey(keyId: string): boolean {
      return keys.has(keyId);
    },
  };
}

/** Ops helper: generate a fresh base64-encoded 32-byte master key. */
export function generateMasterKey(): string {
  return randomBytes(KEY_BYTES).toString('base64');
}

/** Constant-time comparison for key material (avoid accidental `===` on secrets). */
export function keysEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

function normalizeBase64(value: string): string {
  // Round-trip so padding differences don't cause false negatives.
  return Buffer.from(value, 'base64').toString('base64');
}
