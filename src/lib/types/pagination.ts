import { browser } from '$app/environment';
import { allowedPageSizes, defaultPageSize } from '$lib/client/feature-flags.js';

export { allowedPageSizes };
/** @deprecated Use `allowedPageSizes` from `$lib/client/feature-flags.js` directly. */
export { allowedPageSizes as ALLOWED_PAGE_SIZES };
export type PageSize = number;

export function isPageSize(n: number): n is PageSize {
  return allowedPageSizes.includes(n);
}

export function initPageSize(storageKey: string): PageSize {
  if (!browser) return defaultPageSize;
  const stored = parseInt(localStorage.getItem(storageKey) ?? '', 10);
  return isPageSize(stored) ? stored : defaultPageSize;
}
