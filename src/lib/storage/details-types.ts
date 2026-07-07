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
  tree: TreemapNode;
  durationMs: number;
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

/** Bucket configuration details. */
export interface BucketDetails {
  name: string;
  versioningEnabled: boolean;
  lifecycleRules: LifecycleRule[];
  tags: Record<string, string>;
}
