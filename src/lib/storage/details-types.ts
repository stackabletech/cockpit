/** Full metadata for a file object. */
export interface FileDetails {
  key: string;
  name: string;
  size: number;
  lastModified: Date;
  contentType: string | undefined;
  etag: string | undefined;
  customMetadata: Record<string, string> | undefined;
  versionId: string | undefined;
  storageClass: string | undefined;
  isDeleteMarker: boolean;
}

/** A node in the tree for treemap visualization. */
export interface TreemapNode {
  name: string;
  size: number;
  children?: TreemapNode[];
  /** Parent directory path relative to the analyzed prefix (leaf nodes only). */
  path?: string;
  /** Full S3 key including the prefix (leaf nodes only). */
  fullKey?: string;
  /** Set on a synthetic node that stands for this many files left out of the
   *  treemap; `name` is empty and the client renders a label. */
  moreCount?: number;
}

/** Progress event from the directory-size SSE endpoint. */
interface DirectorySizeProgress {
  type: 'progress';
  keysFound: number;
  totalSize: number;
}

/** Final result from the directory-size SSE endpoint. */
export interface DirectorySizeResult {
  type: 'complete';
  totalSize: number;
  totalKeys: number;
  totalFiles: number;
  totalDirectories: number;
  /** Pruned to the largest files; the rest is grouped into `moreCount` nodes. */
  tree: TreemapNode;
  childrenByDepth: Record<number, DirectoryChildList>;
  maxDepth: number;
  durationMs: number;
  /** Listing stopped at the configured key limit; all figures are partial. */
  truncated: boolean;
}

/** Metadata about an S3 directory/folder (bucket ACL + optional directory marker object). */
export interface DirectoryMetadata {
  /** `null` when the bucket ACL could not be loaded. */
  bucketOwner: string | null;
  bucketGrants: Array<{ grantee: string; permission: string }> | null;
  markerExists: boolean;
  markerLastModified?: string;
  markerContentType?: string;
  markerETag?: string;
  markerContentLength?: number;
  markerVersionId?: string;
  markerStorageClass?: string;
  markerServerSideEncryption?: string;
  markerCustomMetadata?: Record<string, string>;
  markerObjectLockMode?: string;
  markerObjectLockRetainUntilDate?: string;
  markerObjectLockLegalHoldStatus?: string;
  markerIsDeleteMarker?: boolean;
}

/** A single child item (file or folder) in the first level of a directory listing. */
export interface DirectoryChildItem {
  name: string;
  size: number;
  lastModified: string | undefined;
  isDirectory: boolean;
}

/** The largest entries at one depth, plus what was left out. */
export interface DirectoryChildList {
  items: DirectoryChildItem[];
  omittedCount: number;
  omittedSize: number;
}

/** Error event from the directory-size SSE endpoint. */
interface DirectorySizeError {
  type: 'error';
  message: string;
}

export type DirectorySizeEvent = DirectorySizeProgress | DirectorySizeResult | DirectorySizeError;

/** Lifecycle rule from S3 bucket lifecycle configuration. */
export interface LifecycleRule {
  id: string;
  status: 'Enabled' | 'Disabled';
  filter: Record<string, unknown>;
  transitions: Array<{ days: number; storageClass: string }>;
  expirations: Array<{ days?: number; date?: string; expiredObjectDeleteMarker?: boolean }>;
  noncurrentVersionTransitions: Array<{ noncurrentDays: number; storageClass: string }>;
  noncurrentVersionExpirations: Array<{ noncurrentDays: number }>;
  abortIncompleteMultipartUploads: Array<{ daysAfterInitiation: number }>;
}

/** Bucket ACL information. */
export interface BucketAcl {
  owner: string;
  grants: Array<{ grantee: string; permission: string }>;
}

/** Bucket versioning state; `Disabled` means versioning was never enabled. */
export type BucketVersioning = 'Enabled' | 'Suspended' | 'Disabled';

/** Bucket configuration details. A `null` field could not be loaded. */
export interface BucketDetails {
  name: string;
  versioning: BucketVersioning | null;
  lifecycleRules: LifecycleRule[] | null;
  tags: Record<string, string> | null;
  acl: BucketAcl | null;
}
