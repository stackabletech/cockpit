import { createContext } from 'svelte';
import type { StorageState } from './state.svelte.js';
import type { TabsState } from './tabs.svelte.js';

export const [getStorageState, setStorageState] = createContext<StorageState>();
export const [getTabsState, setTabsState] = createContext<TabsState>();

/**
 * Lets the connection edit page ask about unsaved changes before the sidebar in its layout
 * deletes a connection.
 */
export interface ConnectionEditGuard {
  /** Resolves `true` when the delete may go ahead; the changes are then discarded. */
  confirmDiscard: (() => Promise<boolean>) | null;
  /** Brings back the discarded changes when the delete failed. */
  restoreChanges: (() => void) | null;
}

export const [getConnectionEditGuard, setConnectionEditGuard] =
  createContext<ConnectionEditGuard>();
