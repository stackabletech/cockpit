import { describe, expect, it } from 'vitest';
import { archiveFileName, clearDownloadRootForTests } from './download-jobs.js';

describe('download jobs', () => {
  it('cleans the on-disk download cache', async () => {
    await expect(clearDownloadRootForTests()).resolves.toBeUndefined();
  });

  it('uses a normal archive name until multipart output is required', () => {
    expect(archiveFileName('reports', 'zip')).toBe('reports.zip');
    expect(archiveFileName('reports', 'zip', 1)).toBe('reports.z01');
    expect(archiveFileName('reports', 'tar.gz', 12)).toBe('reports.part012.tar.gz');
  });
});
