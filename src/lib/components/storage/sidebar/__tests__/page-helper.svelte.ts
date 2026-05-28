/**
 * Test helper to set SvelteKit page state in vitest browser-mode tests.
 *
 * The `page` object from `$app/state` is read-only (getter-only proxy),
 * but the underlying `_page` from SvelteKit's internal state module has
 * writable `$state.raw` fields and an `update()` function that applies
 * partial updates via `Object.assign`.
 *
 * We import the internal module here because `.svelte.ts` files are
 * processed by the SvelteKit vite plugin which resolves the path.
 */

// @ts-expect-error — internal SvelteKit module, not part of public API

import { update } from '../../../../../../node_modules/@sveltejs/kit/src/runtime/client/state.svelte.js';
import type { Page } from '@sveltejs/kit';

export function setPageState(overrides: Partial<Page>): void {
  update(overrides);
}

export function resetPageState(): void {
  update({
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    url: new URL('https://example.com'),
    params: {},
    route: { id: null },
    data: {},
    form: null,
    error: null,
    state: {},
    status: -1
  });
}
