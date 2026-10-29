import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// Without this, unknown API paths fall through to the page catch-all and get
// an HTML error page instead of a JSON body.
export const fallback: RequestHandler = () => error(404, 'Not Found');
