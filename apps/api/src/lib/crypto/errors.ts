/**
 * Crypto errors carry constant messages only. Key material, plaintext, and
 * ciphertext must never appear in an error — errors end up in logs.
 */

export class CryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Ciphertext failed authentication (tampered, wrong key, or AAD mismatch). */
export class DecryptionError extends CryptoError {
  constructor() {
    super('Decryption failed');
  }
}

/** Payload string is not a valid encrypted-value format. */
export class InvalidPayloadError extends CryptoError {
  constructor() {
    super('Invalid encrypted payload format');
  }
}

/** A wrapped key references a key id missing from the keyring. */
export class UnknownKeyIdError extends CryptoError {
  constructor() {
    super('Unknown master key id');
  }
}

/** MASTER_KEYS / MASTER_KEY_ACTIVE env configuration is invalid. */
export class KeyringConfigError extends CryptoError {}
