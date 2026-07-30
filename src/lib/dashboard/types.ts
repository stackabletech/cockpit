export interface Bookmark {
  id: string;
  productId: string;
  name: string;
  environment: string;
  url: string;
  openIn: 'cockpit' | 'new-tab';
  pinned: boolean;
  createdAt: string;
}
