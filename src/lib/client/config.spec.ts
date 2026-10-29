import { describe, it, expect } from 'vitest';
import { parseClientConfig } from './config.js';

describe('parseClientConfig', () => {
  it('uses the defaults when nothing is set', () => {
    expect(parseClientConfig({})).toEqual({
      allowedPageSizes: [25, 50, 100],
      defaultPageSize: 25,
      maxEditableFileSize: 5 * 1024 * 1024,
      maxRecentFiles: 15,
      uploadConcurrency: 3
    });
  });

  it('deduplicates and sorts page sizes', () => {
    const config = parseClientConfig({ PUBLIC_STACKABLE_COCKPIT_PAGE_SIZES: '100, 10,25,10' });
    expect(config.allowedPageSizes).toEqual([10, 25, 100]);
    expect(config.defaultPageSize).toBe(10);
  });

  it('rejects invalid page sizes instead of dropping them', () => {
    expect(() => parseClientConfig({ PUBLIC_STACKABLE_COCKPIT_PAGE_SIZES: '10,abc' })).toThrow(
      /PUBLIC_STACKABLE_COCKPIT_PAGE_SIZES/
    );
  });

  it('requires the default page size to be one of the page sizes', () => {
    expect(
      parseClientConfig({
        PUBLIC_STACKABLE_COCKPIT_PAGE_SIZES: '10,20',
        PUBLIC_STACKABLE_COCKPIT_DEFAULT_PAGE_SIZE: '20'
      }).defaultPageSize
    ).toBe(20);
    expect(() =>
      parseClientConfig({
        PUBLIC_STACKABLE_COCKPIT_PAGE_SIZES: '10,20',
        PUBLIC_STACKABLE_COCKPIT_DEFAULT_PAGE_SIZE: '30'
      })
    ).toThrow(/PUBLIC_STACKABLE_COCKPIT_DEFAULT_PAGE_SIZE: must be one of/);
  });
});
