const DEFAULT_TTL_MS = 5 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 1000;

interface CacheEntry<T> {
  value: T;
  lastAccessed: number;
}

/** In-memory cache that expires inactive entries without retaining request state. */
export class ExpiringCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();
  private readonly timer: ReturnType<typeof setInterval>;

  constructor(private readonly ttlMs = DEFAULT_TTL_MS) {
    this.timer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS);
    this.timer.unref();
  }

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.lastAccessed > this.ttlMs) {
      this.entries.delete(key);
      return undefined;
    }
    entry.lastAccessed = Date.now();
    return entry.value;
  }

  set(key: string, value: T): void {
    this.entries.set(key, { value, lastAccessed: Date.now() });
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (now - entry.lastAccessed > this.ttlMs) this.entries.delete(key);
    }
  }
}

export function previewCacheKey(connectionId: string, bucket: string, key: string): string {
  return `${connectionId}:${bucket}:${key}`;
}
