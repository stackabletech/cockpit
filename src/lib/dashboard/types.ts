export interface Bookmark {
  id: string;
  productId: string;
  name: string;
  environment: string;
  url: string;
  openIn: 'cockpit' | 'new-tab';
  pinned: boolean;
  /** Whether the bookmark is pinned for every user. Admin-only option. */
  pinnedForEveryone?: boolean;
  createdAt: string;
}
