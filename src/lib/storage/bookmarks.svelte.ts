import type { PinnedLocation, RecentFile, RecentLocation } from './types.js';
import {
  LS_PINS,
  LS_RECENT_FILES,
  LS_RECENT_LOCATIONS,
  loadFromStorage,
  persistToStorage
} from './persistence.js';
import { maxRecentFiles } from '$lib/client/feature-flags.js';
import { SvelteDate, SvelteSet } from 'svelte/reactivity';

function dedupByKey<T>(items: T[], keyFn: (item: T) => string): T[] {
  const seen = new SvelteSet<string>();
  return items.filter((item) => {
    const key = keyFn(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export class BookmarksState {
  private readonly connectionId: string;

  pinnedLocations = $state<PinnedLocation[]>([]);
  recentFiles = $state<RecentFile[]>([]);
  recentLocations = $state<RecentLocation[]>([]);

  constructor(connectionId: string) {
    this.connectionId = connectionId;

    this.pinnedLocations = dedupByKey(
      loadFromStorage<PinnedLocation>(LS_PINS).filter((p) => p.connectionId === connectionId),
      (p) => p.bucket + '\0' + p.prefix
    );
    this.recentFiles = dedupByKey(
      loadFromStorage<RecentFile>(LS_RECENT_FILES).filter((f) => f.connectionId === connectionId),
      (f) => f.bucket + '\0' + f.key
    );
    this.recentLocations = dedupByKey(
      loadFromStorage<RecentLocation>(LS_RECENT_LOCATIONS).filter(
        (l) => Boolean(l.bucket) && l.connectionId === connectionId
      ),
      (l) => l.bucket + '\0' + l.prefix
    );
  }

  pin(bucket: string, prefix: string): void {
    if (this.pinnedLocations.some((p) => p.bucket === bucket && p.prefix === prefix)) return;
    this.pinnedLocations.push({ bucket, prefix, connectionId: this.connectionId });
    this.persistPins();
  }

  unpin(bucket: string, prefix: string): void {
    const idx = this.pinnedLocations.findIndex((p) => p.bucket === bucket && p.prefix === prefix);
    if (idx !== -1) {
      this.pinnedLocations.splice(idx, 1);
      this.persistPins();
    }
  }

  isPinned(bucket: string, prefix: string): boolean {
    return this.pinnedLocations.some((p) => p.bucket === bucket && p.prefix === prefix);
  }

  unpinUnderDirectories(bucket: string, dirPrefixes: string[]): void {
    if (dirPrefixes.length === 0) return;
    const underAny = (prefix: string) =>
      dirPrefixes.some((p) => prefix === p || prefix.startsWith(p));
    const before = this.pinnedLocations.length;
    const keep = this.pinnedLocations.filter(
      (pin) => !(pin.bucket === bucket && underAny(pin.prefix))
    );
    if (keep.length !== before) {
      this.pinnedLocations.splice(0, this.pinnedLocations.length, ...keep);
      this.persistPins();
    }
  }

  private persistPins(): void {
    // Merge with entries from other connections so we don't wipe their pins.
    const others = loadFromStorage<PinnedLocation>(LS_PINS).filter(
      (p) => p.connectionId !== this.connectionId
    );
    persistToStorage(LS_PINS, [...others, ...this.pinnedLocations]);
  }

  recordFileVisit(bucket: string, key: string, size: number): void {
    const idx = this.recentFiles.findIndex((f) => f.bucket === bucket && f.key === key);
    const entry: RecentFile = {
      key,
      bucket,
      size,
      visitedAt: new SvelteDate().toISOString(),
      connectionId: this.connectionId
    };
    if (idx !== -1) this.recentFiles.splice(idx, 1);
    this.recentFiles.unshift(entry);
    if (this.recentFiles.length > maxRecentFiles) this.recentFiles.splice(maxRecentFiles);
    const others = loadFromStorage<RecentFile>(LS_RECENT_FILES).filter(
      (f) => f.connectionId !== this.connectionId
    );
    persistToStorage(LS_RECENT_FILES, [...others, ...this.recentFiles]);
  }

  recordLocationVisit(bucket: string, prefix: string): void {
    if (!bucket) return;
    const idx = this.recentLocations.findIndex((l) => l.bucket === bucket && l.prefix === prefix);
    const entry: RecentLocation = {
      bucket,
      prefix,
      visitedAt: new SvelteDate().toISOString(),
      connectionId: this.connectionId
    };
    if (idx !== -1) this.recentLocations.splice(idx, 1);
    this.recentLocations.unshift(entry);
    if (this.recentLocations.length > maxRecentFiles) this.recentLocations.splice(maxRecentFiles);
    const others = loadFromStorage<RecentLocation>(LS_RECENT_LOCATIONS).filter(
      (l) => l.connectionId !== this.connectionId
    );
    persistToStorage(LS_RECENT_LOCATIONS, [...others, ...this.recentLocations]);
  }

  removeFiles(bucket: string, fileKeys: string[]): void {
    if (fileKeys.length === 0) return;
    const keySet = new SvelteSet(fileKeys);
    const before = this.recentFiles.length;
    const keep = this.recentFiles.filter((f) => !(f.bucket === bucket && keySet.has(f.key)));
    if (keep.length !== before) {
      this.recentFiles.splice(0, this.recentFiles.length, ...keep);
      const others = loadFromStorage<RecentFile>(LS_RECENT_FILES).filter(
        (f) => f.connectionId !== this.connectionId
      );
      persistToStorage(LS_RECENT_FILES, [...others, ...keep]);
    }
  }

  removeItemsUnderDirectories(bucket: string, dirPrefixes: string[]): void {
    if (dirPrefixes.length === 0) return;
    const underAny = (path: string) => dirPrefixes.some((p) => path === p || path.startsWith(p));

    const removedFiles = this.recentFiles.filter(
      (f) => f.bucket === bucket && underAny(f.key)
    ).length;
    if (removedFiles > 0) {
      const keep = this.recentFiles.filter((f) => !(f.bucket === bucket && underAny(f.key)));
      this.recentFiles.splice(0, this.recentFiles.length, ...keep);
      const others = loadFromStorage<RecentFile>(LS_RECENT_FILES).filter(
        (f) => f.connectionId !== this.connectionId
      );
      persistToStorage(LS_RECENT_FILES, [...others, ...keep]);
    }

    const removedLocs = this.recentLocations.filter(
      (l) => l.bucket === bucket && underAny(l.prefix)
    ).length;
    if (removedLocs > 0) {
      const keep = this.recentLocations.filter((l) => !(l.bucket === bucket && underAny(l.prefix)));
      this.recentLocations.splice(0, this.recentLocations.length, ...keep);
      const others = loadFromStorage<RecentLocation>(LS_RECENT_LOCATIONS).filter(
        (l) => l.connectionId !== this.connectionId
      );
      persistToStorage(LS_RECENT_LOCATIONS, [...others, ...keep]);
    }
  }
}
