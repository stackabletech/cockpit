import { createContext } from 'svelte';
import type { StorageState } from './state.svelte.js';
import type { TabsState } from './tabs.svelte.js';

export const [getStorageState, setStorageState] = createContext<StorageState>();
export const [getTabsState, setTabsState] = createContext<TabsState>();
