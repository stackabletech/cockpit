import { createContext } from 'svelte';
import type { TabsState } from './tabs.svelte.js';

export const [getTabsState, setTabsState] = createContext<TabsState>();
