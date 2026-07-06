import { describe, expect, it } from 'vitest';
import { parsePayload } from './aes.js';
import {
  createWrappedDataKey,
  decryptWithDataKey,
  encryptWithDataKey,
  rewrapDataKey,
  unwrapDataKey,
} from './envelope.js';
import { DecryptionError, InvalidPayloadError, UnknownKeyIdError } from './errors.js';
import { generateMasterKey, loadMasterKeyring } from './keyring.js';

const k1 = generateMasterKey();
const k2 = generateMasterKey();

const keyring = loadMasterKeyring({ MASTER_KEYS: `k1:${k1}`, MASTER_KEY_ACTIVE: 'k1' });
const AAD = 'user:user_123:session';

describe('envelope encryption', () => {
  it('wraps and unwraps a data key', () => {
    const { wrappedKey } = createWrappedDataKey(keyring, AAD);
    const dataKey = unwrapDataKey(wrappedKey, keyring, AAD);
    expect(dataKey.length).toBe(32);
    expect(parsePayload(wrappedKey).keyId).toBe('k1');
  });

  it('encrypts and decrypts a payload end to end', () => {
    const { wrappedKey } = createWrappedDataKey(keyring, AAD);
    const secret = '1BQANOTREALSESSIONSTRINGxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';

    const ciphertext = encryptWithDataKey(secret, wrappedKey, keyring, AAD);
    expect(ciphertext).not.toContain(secret);

    const decrypted = decryptWithDataKey(ciphertext, wrappedKey, keyring, AAD);
    expect(decrypted.toString('utf8')).toBe(secret);
  });

  it('binds ciphertexts to their AAD context (cross-user swap fails)', () => {
    const { wrappedKey } = createWrappedDataKey(keyring, AAD);
    expect(() => unwrapDataKey(wrappedKey, keyring, 'user:ATTACKER:session')).toThrow(
      DecryptionError,
    );
  });

  it('rejects a wrapped key without an embedded key id', () => {
    // A plain 4-segment payload is not a valid wrapped key.
    const bogus = 'v1.AAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAA.AAAA';
    expect(() => unwrapDataKey(bogus, keyring, AAD)).toThrow(InvalidPayloadError);
  });

  it('throws UnknownKeyIdError when the wrapping key left the keyring', () => {
    const otherRing = loadMasterKeyring({ MASTER_KEYS: `k9:${k2}`, MASTER_KEY_ACTIVE: 'k9' });
    const { wrappedKey } = createWrappedDataKey(keyring, AAD);
    expect(() => unwrapDataKey(wrappedKey, otherRing, AAD)).toThrow(UnknownKeyIdError);
  });

  it('supports master key rotation via rewrapDataKey', () => {
    // 1. Value wrapped under k1.
    const { wrappedKey } = createWrappedDataKey(keyring, AAD);
    const ciphertext = encryptWithDataKey('rotate me', wrappedKey, keyring, AAD);

    // 2. Rotation window: both keys present, k2 active.
    const rotationRing = loadMasterKeyring({
      MASTER_KEYS: `k1:${k1},k2:${k2}`,
      MASTER_KEY_ACTIVE: 'k2',
    });
    const rewrapped = rewrapDataKey(wrappedKey, rotationRing, AAD);
    expect(parsePayload(rewrapped).keyId).toBe('k2');

    // 3. Old key dropped: rewrapped value still decrypts the ORIGINAL ciphertext.
    const finalRing = loadMasterKeyring({ MASTER_KEYS: `k2:${k2}`, MASTER_KEY_ACTIVE: 'k2' });
    const decrypted = decryptWithDataKey(ciphertext, rewrapped, finalRing, AAD);
    expect(decrypted.toString('utf8')).toBe('rotate me');

    // 4. And the pre-rotation wrapped key is now useless with the final ring.
    expect(() => unwrapDataKey(wrappedKey, finalRing, AAD)).toThrow(UnknownKeyIdError);
  });

  it('generates a distinct data key per wrap', () => {
    const a = createWrappedDataKey(keyring, AAD);
    const b = createWrappedDataKey(keyring, AAD);
    expect(
      unwrapDataKey(a.wrappedKey, keyring, AAD).equals(unwrapDataKey(b.wrappedKey, keyring, AAD)),
    ).toBe(false);
  });
});
