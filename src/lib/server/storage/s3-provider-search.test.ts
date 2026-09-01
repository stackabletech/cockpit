import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { S3Client } from '@aws-sdk/client-s3';

vi.mock('$lib/server/logging', () => ({
  logger: { child: () => ({ trace: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }) }
}));

// Mock createS3Client — we inject a fake client directly so this is rarely called
vi.mock('./s3-client.js', () => ({
  createS3Client: vi.fn().mockReturnValue({ send: vi.fn() })
}));

import { S3StorageProvider } from './s3-provider.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProvider() {
  const send = vi.fn();
  const client = { send } as unknown as S3Client;
  const config = {
    type: 's3' as const,
    host: 'minio.example.com',
    accessStyle: 'Path' as const,
    region: { name: 'us-east-1' },
    bucket: 'test-bucket'
  };
  const provider = new S3StorageProvider(config, client);
  return { provider, send };
}

// ---------------------------------------------------------------------------
// listAllKeysProgressively
// ---------------------------------------------------------------------------

describe('S3StorageProvider.listAllKeysProgressively', () => {
  let provider: S3StorageProvider;
  let send: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    ({ provider, send } = makeProvider());
  });

  it('streams batches across pages and resolves', async () => {
    send
      .mockResolvedValueOnce({
        Contents: [{ Key: 'a.txt' }, { Key: 'b.txt' }],
        IsTruncated: true,
        NextContinuationToken: 'token-1'
      })
      .mockResolvedValueOnce({
        Contents: [{ Key: 'c.txt' }],
        IsTruncated: false
      });

    const seen: string[] = [];
    await provider.listAllKeysProgressively('', (batch) => {
      seen.push(...batch.map((k) => k.key));
    });

    expect(seen).toEqual(['a.txt', 'b.txt', 'c.txt']);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('stops paging when the batch callback returns false', async () => {
    send
      .mockResolvedValueOnce({
        Contents: [{ Key: 'a.txt' }, { Key: 'b.txt' }],
        IsTruncated: true,
        NextContinuationToken: 'token-1'
      })
      .mockResolvedValueOnce({
        Contents: [{ Key: 'c.txt' }],
        IsTruncated: false
      });

    const seen: string[] = [];
    await provider.listAllKeysProgressively('', (batch) => {
      seen.push(...batch.map((k) => k.key));
      return false;
    });

    expect(seen).toEqual(['a.txt', 'b.txt']);
    expect(send).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// search
// ---------------------------------------------------------------------------

describe('S3StorageProvider.search', () => {
  let provider: S3StorageProvider;
  let send: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    ({ provider, send } = makeProvider());
  });

  it('matches case-insensitively anywhere in the full key path', async () => {
    send.mockResolvedValue({
      Contents: [
        { Key: 'Reports/2026/Q3/final.pdf', Size: 100, LastModified: new Date('2026-01-01') },
        { Key: 'reports/2026/Q3/final.pdf', Size: 200, LastModified: new Date('2026-01-02') },
        { Key: 'notes/report.txt', Size: 50 },
        { Key: 'other/archive.zip', Size: 10 }
      ],
      IsTruncated: false
    });

    const result = await provider.search('report');

    expect(result.results.map((r) => r.key)).toEqual([
      'Reports/2026/Q3/final.pdf',
      'reports/2026/Q3/final.pdf',
      'notes/report.txt'
    ]);
    expect(result.truncated).toBe(false);
  });

  it('returns files and directories, flagging keys ending in "/"', async () => {
    send.mockResolvedValue({
      Contents: [
        { Key: 'data/', Size: 0, LastModified: new Date('2026-02-01') },
        { Key: 'data/2026/', Size: 0 },
        { Key: 'data/2026/file.csv', Size: 42, LastModified: new Date('2026-02-02') }
      ],
      IsTruncated: false
    });

    const result = await provider.search('data');

    expect(result.results).toHaveLength(3);
    expect(result.results[0]).toMatchObject({
      key: 'data/',
      isDirectory: true,
      size: 0
    });
    expect(result.results[1]).toMatchObject({ key: 'data/2026/', isDirectory: true });
    expect(result.results[2]).toMatchObject({
      key: 'data/2026/file.csv',
      isDirectory: false,
      size: 42
    });
  });

  it('falls back to epoch when lastModified is missing', async () => {
    send.mockResolvedValue({
      Contents: [{ Key: 'plain.txt', Size: 1 }],
      IsTruncated: false
    });

    const result = await provider.search('plain');
    expect(result.results[0].lastModified).toEqual(new Date(0));
  });

  it('respects maxResults and reports truncated', async () => {
    send.mockResolvedValue({
      Contents: Array.from({ length: 10 }, (_, i) => ({ Key: `match-${i}.txt`, Size: 1 })),
      IsTruncated: false
    });

    const result = await provider.search('match', { maxResults: 3 });

    expect(result.results).toHaveLength(3);
    expect(result.truncated).toBe(true);
  });

  it('respects maxKeysScanned and reports truncated', async () => {
    send.mockResolvedValue({
      Contents: Array.from({ length: 100 }, (_, i) => ({ Key: `key-${i}.txt`, Size: 1 })),
      IsTruncated: false
    });

    const result = await provider.search('nomatch', { maxKeysScanned: 10 });

    expect(result.results).toHaveLength(0);
    expect(result.truncated).toBe(true);
  });

  it('lists only the requested prefix and filters depth relative to it', async () => {
    send.mockResolvedValue({
      Contents: [
        { Key: 'reports/final.pdf', Size: 1 },
        { Key: 'reports/2026/final.pdf', Size: 1 },
        { Key: 'reports/2026/q1/final.pdf', Size: 1 }
      ],
      IsTruncated: false
    });

    const result = await provider.search('final', { prefix: 'reports/', maxDepth: 2 });

    expect(result.results.map((item) => item.key)).toEqual([
      'reports/final.pdf',
      'reports/2026/final.pdf'
    ]);
    expect(send.mock.calls[0][0].input.Prefix).toBe('reports/');
  });

  it('stops paging when the scanned-keys cap is reached', async () => {
    send.mockResolvedValue({
      Contents: [
        { Key: 'a.txt', Size: 1 },
        { Key: 'b.txt', Size: 1 },
        { Key: 'c.txt', Size: 1 }
      ],
      IsTruncated: true,
      NextContinuationToken: 'token-1'
    });

    const result = await provider.search('nomatch', { maxKeysScanned: 2 });

    expect(result.results).toEqual([]);
    expect(result.truncated).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('uses defaults when options are omitted', async () => {
    send.mockResolvedValue({ Contents: [], IsTruncated: false });

    const result = await provider.search('x');

    expect(result).toEqual({ results: [], truncated: false });
  });

  it('aborts before scanning when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(provider.search('x', { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError'
    });
    expect(send).not.toHaveBeenCalled();
  });

  it('aborts mid-listing when the signal fires', async () => {
    const controller = new AbortController();
    let callCount = 0;
    send.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          Contents: [{ Key: 'a.txt', Size: 1 }],
          IsTruncated: true,
          NextContinuationToken: 'token-1'
        });
      }
      controller.abort();
      return Promise.resolve({
        Contents: [{ Key: 'b.txt', Size: 1 }],
        IsTruncated: false
      });
    });

    await expect(provider.search('x', { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError'
    });
  });
});
