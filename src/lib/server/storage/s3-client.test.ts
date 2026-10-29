import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { S3ConnectionConfig } from './types.js';

const { mockEnv } = vi.hoisted(() => ({ mockEnv: {} as Record<string, string | undefined> }));
vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));
vi.mock('$lib/server/logging', () => import('$lib/test-utils/mock-logger.js'));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn()
}));

vi.mock('@smithy/node-http-handler', () => ({
  NodeHttpHandler: vi.fn()
}));

import { createS3Client } from './s3-client.js';
import { S3Client } from '@aws-sdk/client-s3';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import type { Agent } from 'https';
const mockS3Client = vi.mocked(S3Client);
const mockHandler = vi.mocked(NodeHttpHandler);

function handlerAgents(call: number) {
  return mockHandler.mock.calls[call]![0] as { httpAgent: Agent; httpsAgent: Agent };
}

function baseConfig(overrides: Partial<S3ConnectionConfig> = {}): S3ConnectionConfig {
  return {
    type: 's3',
    host: 'minio.example.com',
    accessStyle: 'Path',
    region: { name: 'us-east-1' },
    ...overrides
  };
}

describe('createS3Client', () => {
  it('shares keep-alive agents across clients so idle connections are reused', () => {
    mockHandler.mockClear();
    createS3Client(baseConfig({ tls: { verification: 'Full' } }));
    createS3Client(baseConfig({ host: 'other.example.com', tls: { verification: 'Full' } }));
    expect(handlerAgents(0).httpAgent).toBe(handlerAgents(1).httpAgent);
    expect(handlerAgents(0).httpsAgent).toBe(handlerAgents(1).httpsAgent);
    expect(handlerAgents(0).httpsAgent.options.keepAlive).toBe(true);
    expect(handlerAgents(0).httpsAgent.options.rejectUnauthorized).not.toBe(false);
  });

  it('uses a separate unverified agent when TLS verification is disabled', () => {
    mockHandler.mockClear();
    createS3Client(baseConfig({ tls: { verification: 'Full' } }));
    createS3Client(baseConfig({ tls: { verification: 'None' } }));
    expect(handlerAgents(1).httpsAgent).not.toBe(handlerAgents(0).httpsAgent);
    expect(handlerAgents(1).httpsAgent.options.rejectUnauthorized).toBe(false);
  });

  it('builds an http endpoint when tls is absent', () => {
    createS3Client(baseConfig({ tls: undefined }));
    expect(mockS3Client).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: 'http://minio.example.com',
        requestChecksumCalculation: 'WHEN_REQUIRED'
      })
    );
  });

  it('builds an https endpoint when tls is present', () => {
    createS3Client(baseConfig({ tls: { verification: 'Full' } }));
    expect(mockS3Client).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: 'https://minio.example.com',
        requestChecksumCalculation: 'WHEN_REQUIRED'
      })
    );
  });

  it('includes port in the endpoint URL when port is set', () => {
    createS3Client(baseConfig({ port: 9000, tls: undefined }));
    expect(mockS3Client).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: 'http://minio.example.com:9000',
        requestChecksumCalculation: 'WHEN_REQUIRED'
      })
    );
  });

  it('sets forcePathStyle=true for Path access style', () => {
    createS3Client(baseConfig({ accessStyle: 'Path' }));
    expect(mockS3Client).toHaveBeenCalledWith(
      expect.objectContaining({
        forcePathStyle: true,
        requestChecksumCalculation: 'WHEN_REQUIRED'
      })
    );
  });

  it('sets forcePathStyle=false for VirtualHosted access style', () => {
    createS3Client(baseConfig({ accessStyle: 'VirtualHosted' }));
    expect(mockS3Client).toHaveBeenCalledWith(
      expect.objectContaining({
        forcePathStyle: false,
        requestChecksumCalculation: 'WHEN_REQUIRED'
      })
    );
  });

  it('passes region name to the SDK', () => {
    createS3Client(baseConfig({ region: { name: 'eu-west-1' } }));
    expect(mockS3Client).toHaveBeenCalledWith(
      expect.objectContaining({
        region: 'eu-west-1',
        requestChecksumCalculation: 'WHEN_REQUIRED'
      })
    );
  });

  it('sets credentials when accessKey and secretKey are provided', () => {
    createS3Client(baseConfig({ credentials: { accessKey: 'AKID', secretKey: 'SECRET' } }));
    expect(mockS3Client).toHaveBeenCalledWith(
      expect.objectContaining({
        credentials: { accessKeyId: 'AKID', secretAccessKey: 'SECRET' },
        requestChecksumCalculation: 'WHEN_REQUIRED'
      })
    );
  });

  it('does not set credentials when credentials is absent', () => {
    createS3Client(baseConfig({ credentials: undefined }));
    const call = mockS3Client.mock.calls.at(-1)![0] as { credentials?: unknown };
    expect(call.credentials).toBeUndefined();
  });
});

describe('createS3Client custom CA certificate', () => {
  let dir: string | undefined;

  afterEach(() => {
    delete mockEnv.STACKABLE_COCKPIT_STORAGE_TLS_CA_CERT;
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  /** Imports a fresh copy of the module so it reads the current environment. */
  async function freshClient() {
    vi.resetModules();
    const { createS3Client: create } = await import('./s3-client.js');
    const { NodeHttpHandler: handler } = await import('@smithy/node-http-handler');
    return { create, handler: vi.mocked(handler) };
  }

  function lastHttpsAgent(handler: typeof mockHandler) {
    return (handler.mock.calls.at(-1)![0] as { httpsAgent: Agent }).httpsAgent;
  }

  it('uses the bundled CAs when no CA certificate is configured', async () => {
    const { create, handler } = await freshClient();
    create(baseConfig({ tls: { verification: 'Full' } }));
    expect(lastHttpsAgent(handler).options.ca).toBeUndefined();
  });

  it('trusts only the configured CA certificate for verified connections', async () => {
    dir = mkdtempSync(join(tmpdir(), 's3-ca-'));
    const caPath = join(dir, 'ca.crt');
    writeFileSync(caPath, 'test-ca');
    mockEnv.STACKABLE_COCKPIT_STORAGE_TLS_CA_CERT = caPath;

    const { create, handler } = await freshClient();
    create(baseConfig({ tls: { verification: 'Full' } }));
    expect(lastHttpsAgent(handler).options.ca?.toString()).toBe('test-ca');

    create(baseConfig({ tls: { verification: 'None' } }));
    expect(lastHttpsAgent(handler).options.ca).toBeUndefined();
    expect(lastHttpsAgent(handler).options.rejectUnauthorized).toBe(false);
  });

  it('fails with the variable name when the CA certificate cannot be read', async () => {
    mockEnv.STACKABLE_COCKPIT_STORAGE_TLS_CA_CERT = '/nonexistent/ca.crt';
    await expect(freshClient()).rejects.toThrow(
      /STACKABLE_COCKPIT_STORAGE_TLS_CA_CERT \(\/nonexistent\/ca\.crt\)/
    );
  });
});
