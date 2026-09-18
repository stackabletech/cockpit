import { describe, it, expect } from 'vitest';
import {
  StorageConnectionSchema,
  EditStorageConnectionSchema,
  ConnectionIdSchema
} from './schemas.js';

describe('StorageConnectionSchema', () => {
  it('accepts a minimal valid connection', () => {
    const result = StorageConnectionSchema.safeParse({ host: 's3.example.com' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.host).toBe('s3.example.com');
      expect(result.data.type).toBe('s3');
      expect(result.data.accessStyle).toBe('VirtualHosted');
      expect(result.data.region).toEqual({ name: 'us-east-1' });
      expect(result.data.credentials).toEqual({ accessKey: '', secretKey: '' });
    }
  });

  it('rejects missing host', () => {
    const result = StorageConnectionSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects empty host', () => {
    const result = StorageConnectionSchema.safeParse({ host: '' });
    expect(result.success).toBe(false);
  });

  it('strips scheme from host when URL is provided', () => {
    const result = StorageConnectionSchema.safeParse({ host: 'https://s3.example.com:9000' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.host).toBe('s3.example.com');
    }
  });

  it('strips scheme and path from complex URL', () => {
    const result = StorageConnectionSchema.safeParse({
      host: 'http://storage.example.com/some/path'
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.host).toBe('storage.example.com');
    }
  });

  it('accepts port', () => {
    const result = StorageConnectionSchema.safeParse({ host: 's3.example.com', port: 9000 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.port).toBe(9000);
    }
  });

  it('rejects port out of range', () => {
    const result = StorageConnectionSchema.safeParse({ host: 's3.example.com', port: 99999 });
    expect(result.success).toBe(false);
  });

  it('accepts empty string port as undefined', () => {
    const result = StorageConnectionSchema.safeParse({ host: 's3.example.com', port: '' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.port).toBeUndefined();
    }
  });

  it('accepts tls verification', () => {
    const result = StorageConnectionSchema.safeParse({
      host: 's3.example.com',
      tls: { verification: 'None' }
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tls).toEqual({ verification: 'None' });
    }
  });

  it('rejects tls with invalid verification value', () => {
    const result = StorageConnectionSchema.safeParse({
      host: 's3.example.com',
      tls: { verification: 'Invalid' }
    });
    expect(result.success).toBe(false);
  });

  it('accepts accessStyle', () => {
    const result = StorageConnectionSchema.safeParse({
      host: 's3.example.com',
      accessStyle: 'Path'
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.accessStyle).toBe('Path');
    }
  });

  it('accepts region override', () => {
    const result = StorageConnectionSchema.safeParse({
      host: 's3.example.com',
      region: { name: 'eu-west-1' }
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.region.name).toBe('eu-west-1');
    }
  });

  it('rejects empty region name', () => {
    const result = StorageConnectionSchema.safeParse({
      host: 's3.example.com',
      region: { name: '' }
    });
    expect(result.success).toBe(false);
  });

  it('accepts full credentials', () => {
    const result = StorageConnectionSchema.safeParse({
      host: 's3.example.com',
      credentials: { accessKey: 'AKID', secretKey: 'secret' }
    });
    expect(result.success).toBe(true);
  });

  it('rejects accessKey without secretKey', () => {
    const result = StorageConnectionSchema.safeParse({
      host: 's3.example.com',
      credentials: { accessKey: 'AKID', secretKey: '' }
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes('secretKey'))).toBe(true);
    }
  });

  it('rejects secretKey without accessKey', () => {
    const result = StorageConnectionSchema.safeParse({
      host: 's3.example.com',
      credentials: { accessKey: '', secretKey: 'secret' }
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes('accessKey'))).toBe(true);
    }
  });

  it('accepts uuid id', () => {
    const result = StorageConnectionSchema.safeParse({
      id: '550e8400-e29b-41d4-a716-446655440000',
      host: 's3.example.com'
    });
    expect(result.success).toBe(true);
  });

  it('rejects non-uuid id', () => {
    const result = StorageConnectionSchema.safeParse({
      id: 'not-a-uuid',
      host: 's3.example.com'
    });
    expect(result.success).toBe(false);
  });

  it('accepts optional name', () => {
    const result = StorageConnectionSchema.safeParse({
      host: 's3.example.com',
      name: 'My Connection'
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('My Connection');
    }
  });
});

describe('EditStorageConnectionSchema', () => {
  it('accepts accessKey without secretKey', () => {
    const result = EditStorageConnectionSchema.safeParse({
      host: 's3.example.com',
      credentials: { accessKey: 'AKID', secretKey: '' }
    });
    expect(result.success).toBe(true);
  });

  it('still rejects secretKey without accessKey', () => {
    const result = EditStorageConnectionSchema.safeParse({
      host: 's3.example.com',
      credentials: { accessKey: '', secretKey: 'secret' }
    });
    expect(result.success).toBe(false);
  });

  it('accepts both keys as before', () => {
    const result = EditStorageConnectionSchema.safeParse({
      host: 's3.example.com',
      credentials: { accessKey: 'AKID', secretKey: 'secret' }
    });
    expect(result.success).toBe(true);
  });
});

describe('ConnectionIdSchema', () => {
  it('accepts a valid UUID', () => {
    const result = ConnectionIdSchema.safeParse({
      connectionId: '550e8400-e29b-41d4-a716-446655440000'
    });
    expect(result.success).toBe(true);
  });

  it('rejects non-UUID string', () => {
    const result = ConnectionIdSchema.safeParse({ connectionId: 'not-a-uuid' });
    expect(result.success).toBe(false);
  });

  it('rejects missing connectionId', () => {
    const result = ConnectionIdSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});
