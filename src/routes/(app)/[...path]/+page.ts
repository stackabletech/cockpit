import { error } from '@sveltejs/kit';
import type { PageLoad } from './$types';

// Unknown pages render inside the app layout (with navigation) instead of the
// bare root error page. The client router now resolves every unknown path to
// this page, so plain links to `+server.ts` endpoints need `download`,
// `data-sveltekit-reload` or `rel="external"`.
export const load: PageLoad = () => error(404, 'Not Found');
