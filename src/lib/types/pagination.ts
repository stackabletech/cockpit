import { allowedPageSizes, defaultPageSize } from '$lib/client/config.js';
import { readStorage } from '$lib/client/local-storage.js';

export type PageSize = number;

export function isPageSize(n: number): n is PageSize {
  return allowedPageSizes.includes(n);
}

export function initPageSize(storageKey: string): PageSize {
  const stored = parseInt(readStorage(storageKey) ?? '', 10);
  return isPageSize(stored) ? stored : defaultPageSize;
}
