import { describe, it, expect } from 'vitest';
import {
  payloadFingerprint,
  payloadType,
  toConnectionConfig,
  toEndpoint,
  toStoredPayload,
  type StoredPayload
} from './connection-payload.js';

const KEY = Buffer.alloc(32, 0xaa);

const legacyS3: StoredPayload = {
  host: 's3.example.com',
  port: 9000,
  accessStyle: 'Path',
  region: { name: 'us-east-1' },
  credentials: { accessKey: 'ak', secretKey: 'sk' }
};

const hdfs: StoredPayload = { type: 'hdfs', host: 'namenode', port: 9870, devUser: 'dev' };

describe('payloadType', () => {
  it('treats payloads without a type as S3', () => {
    expect(payloadType(legacyS3)).toBe('s3');
    expect(payloadType(hdfs)).toBe('hdfs');
  });
});

describe('toEndpoint', () => {
  it('formats host and optional port', () => {
    expect(toEndpoint({ ...legacyS3, host: 'h', port: 1 })).toBe('h:1');
    expect(toEndpoint({ ...legacyS3, host: 'h', port: undefined })).toBe('h');
    expect(toEndpoint({ ...legacyS3, host: '' })).toBeNull();
  });

  it('uses the first NameNode for HDFS', () => {
    expect(toEndpoint({ type: 'hdfs', host: 'nn0', nameNodes: ['nn0:9870', 'nn1:9870'] })).toBe(
      'nn0:9870'
    );
    expect(toEndpoint({ type: 'hdfs', host: 'nn0', port: 9871, nameNodes: ['nn0', 'nn1'] })).toBe(
      'nn0:9871'
    );
  });
});

describe('toConnectionConfig', () => {
  it('builds an S3 config from a legacy payload', () => {
    expect(toConnectionConfig(legacyS3, ['extra'], { userId: 'u', username: 'alice' })).toEqual({
      type: 's3',
      host: 's3.example.com',
      port: 9000,
      tls: undefined,
      accessStyle: 'Path',
      region: { name: 'us-east-1' },
      credentials: { accessKey: 'ak', secretKey: 'sk' },
      additionalBuckets: ['extra']
    });
  });

  it('drops incomplete S3 credentials', () => {
    const payload = { ...legacyS3, credentials: { accessKey: 'ak', secretKey: '' } };
    const config = toConnectionConfig(payload, [], { userId: 'u', username: null });
    expect(config.type === 's3' && config.credentials).toBeUndefined();
  });

  it('defaults HDFS connections saved before Kerberos support to simple auth', () => {
    expect(toConnectionConfig(hdfs, [], { userId: 'u', username: 'alice' })).toMatchObject({
      auth: 'simple'
    });
  });

  it('round-trips Kerberos settings', () => {
    const payload = toStoredPayload({
      type: 'hdfs',
      host: 'nn',
      user: 'alice',
      auth: 'kerberos',
      servicePrincipal: 'HTTP/hdfs.default.svc.cluster.local'
    });
    expect(payload).toMatchObject({
      auth: 'kerberos',
      servicePrincipal: 'HTTP/hdfs.default.svc.cluster.local'
    });
    expect(toConnectionConfig(payload, [], { userId: 'u', username: 'alice' })).toMatchObject({
      auth: 'kerberos',
      servicePrincipal: 'HTTP/hdfs.default.svc.cluster.local'
    });
  });

  it('passes the HDFS NameNode list through', () => {
    const config = toConnectionConfig({ ...hdfs, nameNodes: ['nn0:9870', 'nn1:9870'] }, [], {
      userId: 'u',
      username: 'alice'
    });
    expect(config).toMatchObject({ nameNodes: ['nn0:9870', 'nn1:9870'] });
  });

  it('uses the SSO username for HDFS even when a dev user is stored', () => {
    const config = toConnectionConfig(hdfs, ['/data'], { userId: 'u', username: 'alice' });
    expect(config).toMatchObject({ type: 'hdfs', user: 'alice', additionalBuckets: ['/data'] });
  });

  it('falls back to the stored dev user without OIDC', () => {
    const config = toConnectionConfig(hdfs, [], { userId: 'anonymous', username: null });
    expect(config).toMatchObject({ type: 'hdfs', user: 'dev' });
  });

  it('throws 400 when no HDFS user can be resolved', () => {
    const payload: StoredPayload = { type: 'hdfs', host: 'namenode' };
    expect(() => toConnectionConfig(payload, [], { userId: 'anonymous', username: null })).toThrow(
      expect.objectContaining({ status: 400 })
    );
  });
});

describe('toStoredPayload', () => {
  it('never persists the resolved HDFS user, only the dev user', () => {
    const payload = toStoredPayload({ type: 'hdfs', host: 'nn', port: 9870, user: 'alice' });
    expect(payload).toEqual({ type: 'hdfs', host: 'nn', port: 9870, tls: undefined });
    expect(toStoredPayload({ type: 'hdfs', host: 'nn', user: 'dev' }, 'dev')).toMatchObject({
      devUser: 'dev'
    });
  });
});

describe('payloadFingerprint', () => {
  it('differs between an anonymous S3 endpoint and HDFS on the same host', () => {
    const anonS3: StoredPayload = {
      type: 's3',
      host: 'shared',
      accessStyle: 'Path',
      region: { name: '' }
    };
    const hdfsSameHost: StoredPayload = { type: 'hdfs', host: 'shared' };
    expect(payloadFingerprint(anonS3, KEY)).not.toBe(payloadFingerprint(hdfsSameHost, KEY));
  });

  it('differs when the HDFS NameNode list changes', () => {
    const one: StoredPayload = { type: 'hdfs', host: 'nn0', nameNodes: ['nn0:9870'] };
    const two: StoredPayload = { type: 'hdfs', host: 'nn0', nameNodes: ['nn0:9870', 'nn1:9870'] };
    expect(payloadFingerprint(one, KEY)).not.toBe(payloadFingerprint(two, KEY));
  });

  it('differs between simple and Kerberos connections to the same NameNodes', () => {
    const simple: StoredPayload = { type: 'hdfs', host: 'nn0' };
    const kerberos: StoredPayload = { type: 'hdfs', host: 'nn0', auth: 'kerberos' };
    expect(payloadFingerprint(simple, KEY)).not.toBe(payloadFingerprint(kerberos, KEY));
  });

  it('differs when only the port changes', () => {
    expect(payloadFingerprint({ ...legacyS3, port: 9000 }, KEY)).not.toBe(
      payloadFingerprint({ ...legacyS3, port: 9001 }, KEY)
    );
  });

  it('is identical for a legacy payload and its explicitly typed equivalent', () => {
    expect(payloadFingerprint(legacyS3, KEY)).toBe(
      payloadFingerprint({ ...legacyS3, type: 's3' }, KEY)
    );
  });
});
