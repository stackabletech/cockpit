/** A single object (file or directory) returned from a storage listing. */
export interface StorageObject {
  key: string;
  size: number;
  lastModified: Date;
  isDirectory: boolean;
  contentType: string | undefined;
}

/** Full metadata for a single object. */
export interface StorageMetadata {
  size: number;
  lastModified: Date;
  contentType: string | undefined;
  etag: string | undefined;
  customMetadata: Record<string, string> | undefined;
}

/** A page of listed objects from a storage provider. */
export interface StoragePage {
  objects: StorageObject[];
  hasNextPage: boolean;
  currentPage: number;
  pageSize: number;
  /** Continuation token for the current page (if provided). */
  continuationToken?: string | null;
  /** Token to request the next page from the provider (if any). */
  nextContinuationToken?: string | null;
}
