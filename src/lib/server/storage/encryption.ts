import { createHmac, hkdfSync, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { env } from '$env/dynamic/private';

// Read key material at module init so a missing key fails fast at startup.
const rawKey = env.STACKABLE_COCKPIT_STORAGE_ENCRYPTION_KEY;
if (!rawKey) {
  throw new Error(
    '[storage] STACKABLE_COCKPIT_STORAGE_ENCRYPTION_KEY is not set. ' +
      'Generate a key with: openssl rand -base64 32'
  );
}

// Derive a 32-byte AES-256 key via HKDF-SHA256 so the raw env value can be
// any length / encoding (base64, hex, plain string) without affecting security.
const aesKey = Buffer.from(
  hkdfSync('sha256', Buffer.from(rawKey), 'stackable-storage-connections', 'aes-gcm-key', 32)
);

const IV_BYTES = 12; // 96-bit IV recommended for AES-GCM
const AUTH_TAG_BYTES = 16;

/**
 * Encrypt a plaintext string with AES-256-GCM.
 * Returns `<iv_b64>.<authtag_b64>.<ciphertext_b64>`.
 */
export function encrypt(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', aesKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString('base64'), authTag.toString('base64'), ciphertext.toString('base64')].join(
    '.'
  );
}

/**
 * Decrypt a value produced by `encrypt()`.
 * Throws if the input is malformed or the auth tag does not match (tampered data).
 */
export function decrypt(encoded: string): string {
  const parts = encoded.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted payload format');
  }
  const [ivB64, authTagB64, ciphertextB64] = parts;
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(authTagB64, 'base64');
  const ciphertext = Buffer.from(ciphertextB64, 'base64');

  if (iv.length !== IV_BYTES || authTag.length !== AUTH_TAG_BYTES) {
    throw new Error('Invalid encrypted payload format');
  }

  const decipher = createDecipheriv('aes-256-gcm', aesKey, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(ciphertext, undefined, 'utf8') + decipher.final('utf8');
}

/**
 * Compute a SHA-256 HMAC fingerprint of a connection for deduplication.
 * Uses the HKDF-derived key so fingerprints are scoped to this installation.
 */
export function connectionFingerprint(...parts: string[]): string {
  return createHmac('sha256', aesKey).update(parts.join('|')).digest('hex');
}
