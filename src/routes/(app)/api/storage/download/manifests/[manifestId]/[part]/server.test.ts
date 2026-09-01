import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/storage/download-manifests.js', () => ({ openDownloadManifestPart: vi.fn() }));
import { openDownloadManifestPart } from '$lib/server/storage/download-manifests.js';
import { GET } from './+server.js';

describe('GET /api/storage/download/manifests/:manifestId/:part', () => {
  beforeEach(() => vi.clearAllMocks());

  it('streams a manifest part with its exact Content-Length and no connection header', async () => {
    vi.mocked(openDownloadManifestPart).mockResolvedValue({
      stream: new ReadableStream({ start: (controller) => controller.close() }),
      file: { filename: 'reports.zip', size: 5000, part: 1 }
    });
    const response = await GET({
      locals: { user: { id: 'user-1' } },
      params: { manifestId: 'manifest-1', part: '1' },
      url: new URL('https://example.test/api/storage/download/manifests/manifest-1/1')
    } as Parameters<typeof GET>[0]);
    expect(response.headers.get('Content-Length')).toBe('5000');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(openDownloadManifestPart).toHaveBeenCalledWith('user-1', 'manifest-1', 1);
  });

  it('streams an archived manifest part with its exact Content-Length', async () => {
    vi.mocked(openDownloadManifestPart).mockResolvedValue({
      stream: new ReadableStream({ start: (controller) => controller.close() }),
      file: { filename: 'reports.zip', size: 5000, part: 1 }
    });
    const response = await GET({
      locals: { user: { id: 'user-1' } },
      params: { manifestId: 'manifest-1', part: '1' },
      url: new URL('https://example.test/api/storage/download/manifests/manifest-1/1')
    } as Parameters<typeof GET>[0]);
    expect(response.headers.get('Content-Length')).toBe('5000');
    expect(response.headers.get('Content-Disposition')).toContain('reports.zip');
  });

  it('marks a stream that ends short of Content-Length as cancelled', async () => {
    vi.mocked(openDownloadManifestPart).mockResolvedValue({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2]));
          controller.close();
        }
      }),
      file: { filename: 'partial.bin', size: 3, part: 1 }
    });
    const response = await GET({
      locals: { user: { id: 'user-1' } },
      params: { manifestId: 'manifest-1', part: '1' },
      url: new URL('https://example.test/api/storage/download/manifests/manifest-1/1?jobId=job-1')
    } as Parameters<typeof GET>[0]);

    await response.arrayBuffer();

    const { getJob } = await import('$lib/server/storage/job-store.js');
    expect(getJob('job-1')?.status).toBe('cancelled');
  });
});
