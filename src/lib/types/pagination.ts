import { browser } from '$app/environment';

export const ALLOWED_PAGE_SIZES = [25, 50, 100] as const;
export type PageSize = (typeof ALLOWED_PAGE_SIZES)[number];

export function isPageSize(n: number): n is PageSize {
  return (ALLOWED_PAGE_SIZES as readonly number[]).includes(n);
}

export function initPageSize(storageKey: string): PageSize {
  if (!browser) return 25;
  const stored = parseInt(localStorage.getItem(storageKey) ?? '', 10);
  return isPageSize(stored) ? stored : 25;
}
