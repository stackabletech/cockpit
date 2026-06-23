import { vi, beforeEach, afterEach } from 'vitest';

// Mock client feature flags so tests don't try to resolve the SvelteKit
// $env/dynamic/public virtual module, which is undefined in the Vitest
// browser environment. Values match the defaults used in production when no
// env vars are set.
vi.mock('$lib/client/feature-flags.js', () => ({
  storageAutoConnectEnabled: false,
  allowedPageSizes: [25, 50, 100],
  defaultPageSize: 25,
  maxRecentFiles: 15
}));

// Prevent components from auto-submitting forms in browser tests.
// Some components call formRef.requestSubmit() after filling fields (e.g.
// StorageConnectForm's selectConnection). Without a server to handle the
// resulting fetch, superforms produces an unhandled rejection that the
// Chromium test runner reports as an "Internal Error". Replace requestSubmit
// with a no-op for the duration of each test.
beforeEach(() => {
  vi.spyOn(HTMLFormElement.prototype, 'requestSubmit').mockImplementation(() => {});
});

// Clean up global stubs (e.g. vi.stubGlobal('fetch', ...)) left behind by
// previous test files.  Without this, stubs leak across files in the shared
// browser context and cause runtime errors in components that don't mock
// those globals themselves.
afterEach(() => {
  vi.unstubAllGlobals();

  // Remove vite-error-overlay elements left behind by previous tests that
  // threw runtime errors.  These persist in the shared browser DOM and can
  // interfere with subsequent test assertions.
  document.querySelectorAll('vite-error-overlay').forEach((el) => el.remove());
});
