// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces

declare global {
  namespace App {
    interface Error {
      requestId?: string;
    }
    interface Locals {
      logger: import('pino').Logger;
      requestId: string;
    }
    // interface PageData {}
    // interface PageState {}
    // interface Platform {}
  }

  namespace svelteHTML {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    interface HTMLAttributes<T> {
      popover?: boolean | '' | 'auto' | 'manual';
      popovertarget?: string;
      popovertargetaction?: 'show' | 'hide' | 'toggle';
    }
  }
}

export {};
