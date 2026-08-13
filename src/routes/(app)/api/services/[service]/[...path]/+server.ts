import type { RequestHandler } from './$types';
import { proxyEmbeddedService } from '$lib/server/embedded-services.js';

export const GET: RequestHandler = (event) => proxyEmbeddedService(event, event.params.service);
export const POST: RequestHandler = (event) => proxyEmbeddedService(event, event.params.service);
export const PUT: RequestHandler = (event) => proxyEmbeddedService(event, event.params.service);
export const PATCH: RequestHandler = (event) => proxyEmbeddedService(event, event.params.service);
export const DELETE: RequestHandler = (event) => proxyEmbeddedService(event, event.params.service);
export const OPTIONS: RequestHandler = (event) => proxyEmbeddedService(event, event.params.service);
export const HEAD: RequestHandler = (event) => proxyEmbeddedService(event, event.params.service);
