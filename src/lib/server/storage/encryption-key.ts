import { env } from '$env/dynamic/private';
import { logger } from '$lib/server/logging';

const log = logger.child({ module: 'storage-encryption-key' });

let _key: Buffer | undefined;

/**
 * Returns the AES-256-GCM encryption key for storage connection credentials.
 * Validated and cached on first call; throws a clear error if the env var is
 * missing or invalid.  Exported as a function (not a module-level constant) so
 * that the Vite SSR module runner can import this file without throwing during
 * test runs where the env var is not set.
 */
export function storageEncryptionKey(): Buffer {
  if (_key) return _key;

  const raw = env.STORAGE_ENCRYPTION_KEY;

  if (!raw) {
    log.error('STORAGE_ENCRYPTION_KEY environment variable is not set');
    throw new Error(
      'STORAGE_ENCRYPTION_KEY is required. Set it to a 64-character hex string (32 bytes).'
    );
  }

  if (raw.length !== 64 || !/^[0-9a-fA-F]+$/.test(raw)) {
    log.error('STORAGE_ENCRYPTION_KEY is not a valid 64-character hex string');
    throw new Error(
      'STORAGE_ENCRYPTION_KEY must be a 64-character hex string (32 bytes). ' +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
  }

  _key = Buffer.from(raw, 'hex');
  return _key;
}
