import { describe, it, expect } from 'vitest';
import { encrypt, decrypt, fingerprint } from './encryption.js';

const TEST_KEY = Buffer.from('a'.repeat(64), 'hex'); // 32 bytes of 0xaa

describe('encrypt / decrypt', () => {
  it('round-trips a plaintext string', () => {
    const plaintext = 'hello, world!';
    const ciphertext = encrypt(plaintext, TEST_KEY);
    expect(decrypt(ciphertext, TEST_KEY)).toBe(plaintext);
  });

  it('round-trips an empty string', () => {
    const ciphertext = encrypt('', TEST_KEY);
    expect(decrypt(ciphertext, TEST_KEY)).toBe('');
  });

  it('round-trips a JSON payload', () => {
    const payload = JSON.stringify({
      endpoint: 'https://minio.example.com:9000',
      region: 'eu-central-1',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'
    });
    const ciphertext = encrypt(payload, TEST_KEY);
    expect(decrypt(ciphertext, TEST_KEY)).toBe(payload);
  });

  it('produces different ciphertexts for the same plaintext (random IV)', () => {
    const plaintext = 'same input';
    const c1 = encrypt(plaintext, TEST_KEY);
    const c2 = encrypt(plaintext, TEST_KEY);
    expect(c1).not.toBe(c2);
    // Both must decrypt to the same plaintext.
    expect(decrypt(c1, TEST_KEY)).toBe(plaintext);
    expect(decrypt(c2, TEST_KEY)).toBe(plaintext);
  });

  it('throws when the ciphertext is tampered with', () => {
    const ciphertext = encrypt('secret', TEST_KEY);
    // Flip a byte in the middle of the ciphertext.
    const buf = Buffer.from(ciphertext, 'hex');
    buf[16] ^= 0xff;
    const tampered = buf.toString('hex');
    expect(() => decrypt(tampered, TEST_KEY)).toThrow();
  });

  it('throws when the wrong key is used', () => {
    const wrongKey = Buffer.alloc(32, 0x00);
    const ciphertext = encrypt('secret', TEST_KEY);
    expect(() => decrypt(ciphertext, wrongKey)).toThrow();
  });
});

describe('fingerprint', () => {
  it('returns a 64-char hex string', () => {
    const fp = fingerprint(
      {
        endpoint: 'https://s3.example.com',
        region: 'us-east-1',
        accessKeyId: 'key',
        secretAccessKey: 'secret'
      },
      TEST_KEY
    );
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic for the same input', () => {
    const creds = {
      endpoint: 'https://s3.example.com',
      region: 'us-east-1',
      accessKeyId: 'key',
      secretAccessKey: 'secret'
    };
    expect(fingerprint(creds, TEST_KEY)).toBe(fingerprint(creds, TEST_KEY));
  });

  it('differs when endpoint changes', () => {
    const base = { region: 'us-east-1', accessKeyId: 'key', secretAccessKey: 'secret' };
    const fp1 = fingerprint({ ...base, endpoint: 'https://s3.example.com' }, TEST_KEY);
    const fp2 = fingerprint({ ...base, endpoint: 'https://other.example.com' }, TEST_KEY);
    expect(fp1).not.toBe(fp2);
  });

  it('differs when access key changes', () => {
    const base = {
      endpoint: 'https://s3.example.com',
      region: 'us-east-1',
      secretAccessKey: 'secret'
    };
    const fp1 = fingerprint({ ...base, accessKeyId: 'key1' }, TEST_KEY);
    const fp2 = fingerprint({ ...base, accessKeyId: 'key2' }, TEST_KEY);
    expect(fp1).not.toBe(fp2);
  });

  it('differs when the HMAC key changes', () => {
    const creds = {
      endpoint: '',
      region: 'us-east-1',
      accessKeyId: 'key',
      secretAccessKey: 'secret'
    };
    const otherKey = Buffer.alloc(32, 0x55);
    expect(fingerprint(creds, TEST_KEY)).not.toBe(fingerprint(creds, otherKey));
  });
});
