// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces

/// <reference types="unplugin-icons/types/svelte" />

import type { auth } from '$lib/server/auth';

declare global {
  namespace App {
    interface Error {
      requestId?: string;
    }
    interface Locals {
      user: typeof auth.$Infer.Session.user | null;
      session: typeof auth.$Infer.Session.session | null;
      logger: import('pino').Logger;
      requestId: string;
      /**
       * Populated by the `handleStorageConnection` middleware for requests to
       * `/(app)/storage/api/*` routes. Loaded from the DB using the session's
       * `activeStorageConnectionId`. Always non-null when the handler runs
       * (the middleware throws 401 if the connection is absent or stale).
       * Null for all other routes.
       */
      storageConfig: import('$lib/server/storage/types.js').S3ConnectionConfig | null;
    }
    // interface PageData {}
    // interface PageState {}
    // interface Platform {}
  }
}

export {};
