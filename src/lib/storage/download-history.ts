import type { DownloadHistoryEntry } from './api.js';

/** Return the persisted payload size for the selected history entries. */
export function selectedDownloadHistoryPayloadSize(
  entries: DownloadHistoryEntry['entries'],
  selectedKeys: Iterable<string>
): number {
  const entriesByKey = new Map(entries.map((entry) => [entry.key, entry]));
  const selectedEntries = new Map<string, DownloadHistoryEntry['entries'][number]>();

  for (const key of selectedKeys) {
    const entry = entriesByKey.get(key);
    if (!entry) continue;
    if (entry.isDirectory) {
      for (const descendant of entries) {
        if (descendant.key === entry.key || descendant.key.startsWith(entry.key)) {
          selectedEntries.set(descendant.key, descendant);
        }
      }
    } else {
      selectedEntries.set(entry.key, entry);
    }
  }

  return [...selectedEntries.values()].reduce((total, entry) => total + entry.size, 0);
}
