/**
 * Structured logging module for Stackable UI.
 *
 * ## Request-scoped logging (in +page.server.ts, +server.ts, hooks)
 *
 * ```typescript
 * export const load: PageServerLoad = async (event) => {
 *   const log = event.locals.logger;
 *   log.info({ catalog_name }, 'Loading catalog');
 * };
 * ```
 *
 * ## Module-level logging (singletons, services)
 *
 * ```typescript
 * import { logger } from '$lib/server/logging';
 * const log = logger.child({ module: 'trino-client' });
 * log.info({ trino_url }, 'Connecting to Trino');
 * ```
 */

export { logger } from './logger.js';
export { requestLogger } from './request-logger.js';
export type { LoggingConfig } from './types.js';
