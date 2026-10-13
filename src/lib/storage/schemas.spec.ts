import { describe, it, expect } from 'vitest';
import {
  StorageConnectionSchema,
  EditStorageConnectionSchema,
  ConnectionIdSchema,
  StorageObjectNameSchema,
  StorageObjectKeySchema,
  CopyObjectsBodySchema,
  MoveObjectsBodySchema,
  DeleteObjectsBodySchema
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

  it('rejects malformed host values', () => {
    expect(StorageConnectionSchema.safeParse({ host: '%/()$=("?§/(' }).success).toBe(false);
  });

  it.each([
    ['[::1]', '[::1]'],
    ['[fd00::1]', '[fd00::1]'],
    ['::1', '[::1]'],
    ['http://[::1]:9000', '[::1]'],
    ['https://[fd00::1]/path', '[fd00::1]']
  ])('accepts IPv6 host %s and stores it bracketed', (host, expected) => {
    const result = StorageConnectionSchema.safeParse({ host });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.host).toBe(expected);
    }
  });

  it.each(['[::1', '::1]', '[]', '[not-ipv6]', '[127.0.0.1]', '[::1]:9000', 's3.example.com:9000'])(
    'rejects invalid host %s',
    (host) => {
      expect(StorageConnectionSchema.safeParse({ host }).success).toBe(false);
    }
  );

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

describe('storage object schemas', () => {
  it('accepts a valid nested object name', () => {
    expect(StorageObjectNameSchema.safeParse('reports/April 2026.csv').success).toBe(true);
  });

  it('accepts Unicode object names', () => {
    expect(StorageObjectNameSchema.safeParse('Bücher/verträge.pdf').success).toBe(true);
  });

  it('rejects relative segments and unsupported characters', () => {
    expect(StorageObjectNameSchema.safeParse('../secrets.txt').success).toBe(false);
    expect(StorageObjectNameSchema.safeParse('report?.csv').success).toBe(false);
  });

  it('validates copy, move, and delete request bodies at runtime', () => {
    expect(
      CopyObjectsBodySchema.safeParse({
        sourceKeys: ['source.csv'],
        destinationPrefix: '',
        sourceBucket: 'source'
      }).success
    ).toBe(true);
    expect(MoveObjectsBodySchema.safeParse({ sourceKeys: ['source.csv'] }).success).toBe(false);
    expect(
      MoveObjectsBodySchema.safeParse({
        sourceKeys: ['source.csv', 'second.csv'],
        destinationKey: 'target.csv'
      }).success
    ).toBe(false);
    expect(DeleteObjectsBodySchema.safeParse({ keys: [''] }).success).toBe(false);
  });

  const legalKeys = [
    'reports/what?.csv',
    'quote"d.txt',
    '<tag>.html',
    'back\\slash.txt',
    'pipe|name',
    'dir/.',
    'dir/..',
    '../escape.txt',
    'a/./b/../c',
    'tab\tname.txt',
    'new\nline.txt',
    'carriage\rreturn.txt',
    'start\u0001of heading.txt',
    'nul\u0000.txt',
    'del\u007f.txt'
  ];

  it.each(legalKeys)('accepts the legal S3 key %j as an existing key', (key) => {
    expect(StorageObjectKeySchema.safeParse(key).success).toBe(true);
  });

  it('rejects only empty and over-long keys, as S3 does', () => {
    expect(StorageObjectKeySchema.safeParse('').success).toBe(false);
    expect(StorageObjectKeySchema.safeParse('a'.repeat(1024)).success).toBe(true);
    expect(StorageObjectKeySchema.safeParse('ä'.repeat(512)).success).toBe(true);
    expect(StorageObjectKeySchema.safeParse('ä'.repeat(513)).success).toBe(false);
    expect(StorageObjectKeySchema.safeParse('\t'.repeat(1024)).success).toBe(true);
  });

  it('accepts legal S3 keys in delete, move and copy request bodies', () => {
    expect(DeleteObjectsBodySchema.safeParse({ keys: legalKeys }).success).toBe(true);
    expect(
      MoveObjectsBodySchema.safeParse({
        sourceKeys: ['odd/what?.csv'],
        destinationKey: 'odd/../renamed.csv'
      }).success
    ).toBe(true);
    expect(
      MoveObjectsBodySchema.safeParse({ sourceKeys: legalKeys, destinationPrefix: 'x|y/../' })
        .success
    ).toBe(true);
    expect(
      CopyObjectsBodySchema.safeParse({ sourceKeys: legalKeys, destinationPrefix: 'a\\b/' }).success
    ).toBe(true);
  });

  it('keeps leading and trailing whitespace in object keys', () => {
    expect(StorageObjectNameSchema.parse(' a ')).toBe(' a ');
    const result = DeleteObjectsBodySchema.safeParse({ keys: ['a '] });
    expect(result.success && result.data.keys).toEqual(['a ']);
  });
});
