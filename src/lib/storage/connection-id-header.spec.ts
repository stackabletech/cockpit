import { describe, it, expect } from 'vitest';
import { STORAGE_CONNECTION_ID_HEADER, type SavedConnection } from './connection-id-header.js';

describe('STORAGE_CONNECTION_ID_HEADER', () => {
  it('exports the expected header name', () => {
    expect(STORAGE_CONNECTION_ID_HEADER).toBe('x-storage-connection-id');
  });
});

describe('SavedConnection type', () => {
  it('is structurally compatible with a valid connection object', () => {
    const conn: SavedConnection = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      name: 'My S3',
      host: 's3.example.com',
      port: 443,
      type: 's3',
      region: { name: 'us-east-1' },
      credentials: { accessKey: 'AKID', secretKey: 'secret' }
    };
    expect(conn.id).toBe('550e8400-e29b-41d4-a716-446655440000');
    expect(conn.type).toBe('s3');
  });

  it('allows optional port and credentials', () => {
    const conn: SavedConnection = {
      id: '550e8400-e29b-41d4-a716-446655440001',
      name: 'Minimal',
      host: 'minio.example.com',
      port: null,
      type: 's3',
      region: { name: 'eu-central-1' }
    };
    expect(conn.host).toBe('minio.example.com');
    expect(conn.port).toBeNull();
  });
});
