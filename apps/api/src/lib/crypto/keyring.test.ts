import { describe, expect, it } from 'vitest';
import { KeyringConfigError, UnknownKeyIdError } from './errors.js';
import { generateMasterKey, keysEqual, loadMasterKeyring } from './keyring.js';

const k1 = generateMasterKey();
const k2 = generateMasterKey();

describe('master keyring', () => {
  it('loads a single-key keyring', () => {
    const keyring = loadMasterKeyring({ MASTER_KEYS: `k1:${k1}`, MASTER_KEY_ACTIVE: 'k1' });
    expect(keyring.activeKeyId).toBe('k1');
    expect(keyring.getKey('k1').toString('base64')).toBe(k1);
    expect(keyring.hasKey('k1')).toBe(true);
    expect(keyring.hasKey('nope')).toBe(false);
  });

  it('loads a multi-key keyring with a non-first active key', () => {
    const keyring = loadMasterKeyring({
      MASTER_KEYS: `k1:${k1},k2:${k2}`,
      MASTER_KEY_ACTIVE: 'k2',
    });
    expect(keyring.activeKeyId).toBe('k2');
    expect(keysEqual(keyring.getKey('k2'), Buffer.from(k2, 'base64'))).toBe(true);
  });

  it('tolerates whitespace around entries', () => {
    const keyring = loadMasterKeyring({
      MASTER_KEYS: ` k1 : ${k1} , k2 : ${k2} `,
      MASTER_KEY_ACTIVE: ' k1 ',
    });
    expect(keyring.hasKey('k2')).toBe(true);
  });

  it('throws UnknownKeyIdError for a missing key id', () => {
    const keyring = loadMasterKeyring({ MASTER_KEYS: `k1:${k1}`, MASTER_KEY_ACTIVE: 'k1' });
    expect(() => keyring.getKey('ghost')).toThrow(UnknownKeyIdError);
  });

  it('rejects missing or empty configuration', () => {
    expect(() => loadMasterKeyring({ MASTER_KEYS: '', MASTER_KEY_ACTIVE: 'k1' })).toThrow(
      KeyringConfigError,
    );
    expect(() => loadMasterKeyring({ MASTER_KEYS: `k1:${k1}`, MASTER_KEY_ACTIVE: '' })).toThrow(
      KeyringConfigError,
    );
  });

  it('rejects malformed entries', () => {
    expect(() =>
      loadMasterKeyring({ MASTER_KEYS: 'no-colon-here', MASTER_KEY_ACTIVE: 'k1' }),
    ).toThrow(KeyringConfigError);
  });

  it('rejects keys that are not 32 bytes', () => {
    const short = Buffer.alloc(16).toString('base64');
    expect(() =>
      loadMasterKeyring({ MASTER_KEYS: `k1:${short}`, MASTER_KEY_ACTIVE: 'k1' }),
    ).toThrow(KeyringConfigError);
  });

  it('rejects invalid key ids', () => {
    expect(() =>
      loadMasterKeyring({ MASTER_KEYS: `bad.id:${k1}`, MASTER_KEY_ACTIVE: 'bad.id' }),
    ).toThrow(KeyringConfigError);
  });

  it('rejects duplicate key ids', () => {
    expect(() =>
      loadMasterKeyring({ MASTER_KEYS: `k1:${k1},k1:${k2}`, MASTER_KEY_ACTIVE: 'k1' }),
    ).toThrow(KeyringConfigError);
  });

  it('rejects an active id that is not in the keyring', () => {
    expect(() => loadMasterKeyring({ MASTER_KEYS: `k1:${k1}`, MASTER_KEY_ACTIVE: 'k9' })).toThrow(
      KeyringConfigError,
    );
  });

  it('generateMasterKey produces distinct 32-byte keys', () => {
    const a = generateMasterKey();
    const b = generateMasterKey();
    expect(a).not.toBe(b);
    expect(Buffer.from(a, 'base64').length).toBe(32);
  });
});
