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
}

/** Progress event from the directory-size SSE endpoint. */
export interface DirectorySizeProgress {
  type: 'progress';
  keysFound: number;
  totalSize: number;
  subdirs: Record<string, number>;
}

/** Final result from the directory-size SSE endpoint. */
export interface DirectorySizeResult {
  type: 'complete';
  totalSize: number;
  totalKeys: number;
  totalFiles: number;
  totalDirectories: number;
  tree: TreemapNode;
  durationMs: number;
}

/** Metadata about an S3 directory/folder (bucket ACL + optional directory marker object). */
export interface DirectoryMetadata {
  bucketOwner: string;
  bucketGrants: Array<{ grantee: string; permission: string }>;
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

/** Error event from the directory-size SSE endpoint. */
export interface DirectorySizeError {
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

/** Bucket configuration details. */
export interface BucketDetails {
  name: string;
  versioningEnabled: boolean;
  lifecycleRules: LifecycleRule[];
  tags: Record<string, string>;
}
