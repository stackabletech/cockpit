import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit IV recommended for GCM
const AUTH_TAG_LENGTH = 16; // 128-bit authentication tag

/**
 * Encrypt a plaintext string using AES-256-GCM.
 *
 * A random 12-byte IV is generated for each call. The output is the
 * hex-encoded concatenation of: IV (12 bytes) | ciphertext | auth tag (16 bytes).
 *
 * @param plaintext - The string to encrypt.
 * @param key - A 32-byte Buffer (256-bit key).
 * @returns Hex-encoded string: iv + ciphertext + authTag.
 */
export function encrypt(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, encrypted, authTag]).toString('hex');
}

/**
 * Decrypt a hex-encoded AES-256-GCM ciphertext produced by {@link encrypt}.
 *
 * @param ciphertext - Hex-encoded string: iv + ciphertext + authTag.
 * @param key - The same 32-byte Buffer used during encryption.
 * @returns The original plaintext string.
 * @throws Error if the authentication tag verification fails (tampered data).
 */
export function decrypt(ciphertext: string, key: Buffer): string {
  const buf = Buffer.from(ciphertext, 'hex');
  const iv = buf.subarray(0, IV_LENGTH);
  const authTag = buf.subarray(buf.length - AUTH_TAG_LENGTH);
  const encrypted = buf.subarray(IV_LENGTH, buf.length - AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

/**
 * Compute an HMAC-SHA256 fingerprint of the connection credentials.
 * Used to detect duplicate connections before inserting a new row.
 *
 * @param credentials - The connection fields to fingerprint.
 * @param key - The 32-byte application key (used as HMAC key).
 * @returns Hex-encoded HMAC-SHA256 digest.
 */
export function fingerprint(
  credentials: {
    endpoint: string;
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
  },
  key: Buffer
): string {
  const material = [
    credentials.endpoint,
    credentials.region,
    credentials.accessKeyId,
    credentials.secretAccessKey
  ].join('|');
  return createHmac('sha256', key).update(material, 'utf8').digest('hex');
}
