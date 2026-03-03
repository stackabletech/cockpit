import { browser } from '$app/environment';

export const theme = $state({
  current: browser ? (document.documentElement.dataset.theme ?? 'dark') : 'dark'
});
