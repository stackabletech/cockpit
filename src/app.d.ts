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
       * Parsed S3 connection config extracted from the `x-storage-connection`
       * request header by the `handleStorageConnection` middleware.
       * Always non-null for requests to `/(app)/api/storage/*` routes
       * (the middleware throws 401 before the handler runs if the header is absent).
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
