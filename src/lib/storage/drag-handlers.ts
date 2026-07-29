import { SvelteSet } from 'svelte/reactivity';
import { storageCutCopyEnabled, storageMoveEnabled } from '$lib/client/feature-flags.js';

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
  state: { selectedKeys: Set<string>; isInArchive: boolean }
): void {
  if (!storageCutCopyEnabled || state.isInArchive) return;
  if (!state.selectedKeys.has(itemKey)) {
    state.selectedKeys = new SvelteSet<string>([itemKey]);
  }
  e.dataTransfer?.setData('application/x-storage-keys', JSON.stringify([...state.selectedKeys]));
  e.dataTransfer!.effectAllowed = 'move';
}

/**
 * Parse storage keys from a drop event's data transfer.
 * Returns null if the data is missing or invalid.
 */
export function parseStorageDropKeys(e: DragEvent): string[] | null {
  const raw = e.dataTransfer?.getData('application/x-storage-keys');
  if (!raw) return null;
  try {
    return JSON.parse(raw) as string[];
  } catch {
    return null;
  }
}

/**
 * Check whether a storage drag-drop is allowed in the current context.
 */
export function canStorageDrop(storage: { isInArchive: boolean }): boolean {
  return storageMoveEnabled && !storage.isInArchive;
}
