export const ALLOWED_PAGE_SIZES = [25, 50, 100] as const;
export type PageSize = (typeof ALLOWED_PAGE_SIZES)[number];

export function isPageSize(n: number): n is PageSize {
  return (ALLOWED_PAGE_SIZES as readonly number[]).includes(n);
}
