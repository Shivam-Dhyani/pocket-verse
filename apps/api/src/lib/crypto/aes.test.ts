import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decrypt, encrypt, generateDataKey, parsePayload } from './aes.js';
import { DecryptionError, InvalidPayloadError } from './errors.js';

const key = generateDataKey();

describe('aes-256-gcm primitives', () => {
  it('round-trips a string payload', () => {
    const payload = encrypt('hello universe', key);
    expect(decrypt(payload, key).toString('utf8')).toBe('hello universe');
  });

  it('round-trips a buffer payload', () => {
    const input = randomBytes(1024);
    const payload = encrypt(input, key);
    expect(decrypt(payload, key).equals(input)).toBe(true);
  });

  it('round-trips an empty payload', () => {
    const payload = encrypt('', key);
    expect(decrypt(payload, key).length).toBe(0);
  });

  it('round-trips a large (5MB) payload', () => {
    const input = randomBytes(5 * 1024 * 1024);
    const payload = encrypt(input, key);
    expect(decrypt(payload, key).equals(input)).toBe(true);
  });

  it('round-trips with AAD', () => {
    const payload = encrypt('bound value', key, { aad: 'user:abc:session' });
    expect(decrypt(payload, key, { aad: 'user:abc:session' }).toString('utf8')).toBe('bound value');
  });

  it('produces the documented v1 format', () => {
    const payload = encrypt('x', key);
    expect(payload).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });

  it('embeds a key id when provided', () => {
    const payload = encrypt('x', key, { keyId: 'k1' });
    expect(parsePayload(payload).keyId).toBe('k1');
    expect(decrypt(payload, key).toString('utf8')).toBe('x');
  });

  it('uses a unique IV per encryption (same input, different ciphertext)', () => {
    const a = encrypt('same input', key);
    const b = encrypt('same input', key);
    expect(a).not.toBe(b);
    expect(parsePayload(a).iv.equals(parsePayload(b).iv)).toBe(false);
  });

  it('fails with the wrong key', () => {
    const payload = encrypt('secret', key);
    expect(() => decrypt(payload, generateDataKey())).toThrow(DecryptionError);
  });

  it('fails when AAD does not match', () => {
    const payload = encrypt('secret', key, { aad: 'user:abc:session' });
    expect(() => decrypt(payload, key, { aad: 'user:OTHER:session' })).toThrow(DecryptionError);
    expect(() => decrypt(payload, key)).toThrow(DecryptionError);
  });

  it('detects tampering in every segment', () => {
    const payload = encrypt('secret', key, { aad: 'ctx' });
    const segments = payload.split('.');

    for (const index of [1, 2, 3]) {
      const tampered = [...segments];
      const segment = tampered[index] as string;
      // Flip the first character to another base64url character.
      tampered[index] = (segment[0] === 'A' ? 'B' : 'A') + segment.slice(1);
      expect(() => decrypt(tampered.join('.'), key, { aad: 'ctx' })).toThrow();
    }
  });

  it('rejects malformed payloads with InvalidPayloadError', () => {
    for (const bad of ['', 'not-encrypted', 'v1.only.three', 'v2.a.b.c', 'v1.a.b.c.d.e']) {
      expect(() => decrypt(bad, key)).toThrow(InvalidPayloadError);
    }
  });

  it('rejects payloads with wrong iv/tag sizes', () => {
    const shortIv = Buffer.alloc(4).toString('base64url');
    const okTag = Buffer.alloc(16).toString('base64url');
    const ct = Buffer.from('x').toString('base64url');
    expect(() => decrypt(`v1.${shortIv}.${okTag}.${ct}`, key)).toThrow(InvalidPayloadError);
  });

  it('rejects keys that are not 32 bytes', () => {
    expect(() => encrypt('x', Buffer.alloc(16))).toThrow(InvalidPayloadError);
    expect(() => decrypt(encrypt('x', key), Buffer.alloc(31))).toThrow(InvalidPayloadError);
  });

  it('error messages never contain plaintext, key, or ciphertext', () => {
    const payload = encrypt('super-secret-plaintext', key, { aad: 'ctx' });
    try {
      decrypt(payload, generateDataKey(), { aad: 'ctx' });
      expect.unreachable();
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toBe('Decryption failed');
      expect(message).not.toContain('super-secret');
      expect(message).not.toContain(key.toString('base64'));
    }
  });
});
