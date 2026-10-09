import { describe, expect, it } from 'vitest';
import { requireStorageConfig } from './connection.js';
import type { S3ConnectionConfig } from './types.js';

function locals(storageConfig: S3ConnectionConfig | null): App.Locals {
  return { storageConfig } as App.Locals;
}

describe('requireStorageConfig', () => {
  it('returns the parsed connection', () => {
    const config: S3ConnectionConfig = {
      type: 's3',
      host: 's3.example.com',
      accessStyle: 'Path',
      region: { name: 'us-east-1' }
    };
    expect(requireStorageConfig(locals(config))).toBe(config);
  });

  it('throws 401 when no connection was parsed', () => {
    expect(() => requireStorageConfig(locals(null))).toThrow(
      expect.objectContaining({ status: 401 })
    );
  });
});
