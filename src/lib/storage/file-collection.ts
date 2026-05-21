/**
 * File collection utilities for drag-and-drop uploads.
 * Handles directory traversal via the FileSystem API for folder drops.
 */

export type FilePair = { file: File; relativePath: string };

/**
 * Collect files from a DataTransfer (drop event), traversing directories
 * if the FileSystem API is available.
 */
export async function collectDroppedFiles(dt: DataTransfer): Promise<FilePair[]> {
  // Collect FileSystemEntry for each dropped item once (single-use in some browsers).
  const fsEntries = Array.from(dt.items).map((i) => i.webkitGetAsEntry?.() ?? null);

  // If no directories are present, skip async traversal.
  if (!fsEntries.some((e) => e?.isDirectory)) {
    return Array.from(dt.files).map((f) => ({ file: f, relativePath: f.name }));
  }

  const results: FilePair[] = [];
  for (const entry of fsEntries) {
    if (entry) {
      results.push(...(await traverseEntry(entry, '')));
    }
  }
  return results;
}

async function traverseEntry(entry: FileSystemEntry, base: string): Promise<FilePair[]> {
  if (entry.isFile) {
    return new Promise((resolve, reject) => {
      (entry as FileSystemFileEntry).file(
        (f) => resolve([{ file: f, relativePath: base + entry.name }]),
        reject
      );
    });
  }
  if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    const children = await drainReader(reader);
    const newBase = base + entry.name + '/';
    const nested = await Promise.all(children.map((c) => traverseEntry(c, newBase)));
    return nested.flat();
  }
  return [];
}

async function drainReader(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  const all: FileSystemEntry[] = [];
  let batch: FileSystemEntry[];
  do {
    batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
    all.push(...batch);
  } while (batch.length > 0);
  return all;
}
