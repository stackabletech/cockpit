export interface Bookmark {
  id: string;
  productId: string;
  name: string;
  environment: string;
  url: string;
  pinned: boolean;
  /** Whether the bookmark is pinned for every user. Admin-only option. */
  pinnedForEveryone?: boolean;
  createdAt: string;
}
