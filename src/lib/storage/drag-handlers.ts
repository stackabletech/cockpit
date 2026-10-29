import { SvelteSet } from 'svelte/reactivity';
import { storageTransferEnabled } from '$lib/client/feature-flags.js';
import { connectionStore } from './connection-store.svelte.js';
import type { DragSource } from './clipboard.svelte.js';

const KEYS_TYPE = 'application/x-storage-keys';
/** Where the dragged items come from: connection and bucket at drag start. */
const SOURCE_TYPE = 'application/x-storage-source';

/**
 * Auto-select the dragged item if not already selected, then attach
 * the selected keys to the drag event for the drop target.
 *
 * NOTE: `state` must be the reactive storage object so that assignment
 * to `selectedKeys` triggers reactivity.
 */
export function handleRowDragStart(
  e: DragEvent,
  itemKey: string,
  state: { selectedKeys: Set<string>; bucket: string; archive: { isInArchive: boolean } }
): void {
  if (!storageTransferEnabled || state.archive.isInArchive) return;
  if (!state.selectedKeys.has(itemKey)) {
    state.selectedKeys = new SvelteSet<string>([itemKey]);
  }
  e.dataTransfer?.setData(KEYS_TYPE, JSON.stringify([...state.selectedKeys]));
  const source: DragSource = {
    connectionId: connectionStore.activeConnectionId,
    bucket: state.bucket
  };
  e.dataTransfer?.setData(SOURCE_TYPE, JSON.stringify(source));
  e.dataTransfer!.effectAllowed = 'move';
}

/**
 * Parse the dragged keys and where they come from. Returns null if either is
 * missing or invalid, e.g. a drag from an older page or another application.
 */
export function parseStorageDrop(e: DragEvent): { keys: string[]; source: DragSource } | null {
  const rawKeys = e.dataTransfer?.getData(KEYS_TYPE);
  const rawSource = e.dataTransfer?.getData(SOURCE_TYPE);
  if (!rawKeys || !rawSource) return null;
  try {
    const keys = JSON.parse(rawKeys) as unknown;
    const source = JSON.parse(rawSource) as Partial<DragSource>;
    if (!Array.isArray(keys) || !keys.every((key) => typeof key === 'string')) return null;
    if (typeof source.bucket !== 'string') return null;
    return { keys, source: { connectionId: source.connectionId ?? null, bucket: source.bucket } };
  } catch {
    return null;
  }
}

/**
 * Check whether a storage drag-drop is allowed in the current context.
 */
export function canStorageDrop(storage: { archive: { isInArchive: boolean } }): boolean {
  return storageTransferEnabled && !storage.archive.isInArchive;
}
