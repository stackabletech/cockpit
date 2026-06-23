import { createContext } from 'svelte';
import type { StorageState } from './state.svelte.js';

export const [getStorageState, setStorageState] = createContext<StorageState>();

export const [getBucketSidebarToggle, setBucketSidebarToggle] = createContext<() => void>();
