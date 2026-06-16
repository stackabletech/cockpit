import { paraglideVitePlugin } from '@inlang/paraglide-js';
import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import Icons from 'unplugin-icons/vite';
import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';

export default defineConfig({
  plugins: [
    tailwindcss(),
    sveltekit(),
    Icons({ compiler: 'svelte' }),
    paraglideVitePlugin({
      project: './project.inlang',
      outdir: './src/lib/paraglide',
      strategy: ['cookie', 'preferredLanguage', 'baseLocale']
    })
  ],
  // Monaco's web worker must be built as IIFE (classic worker) so it can be
  // loaded without { type: 'module' }. Vite 7 defaults to 'es' (module
  // workers), which causes silent failures in Firefox headless CI.
  worker: { format: 'iife' },
  server: { allowedHosts: true },
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['json', 'json-summary'],
      reportsDirectory: './coverage'
    },
    expect: { requireAssertions: true },
    projects: [
      {
        extends: './vite.config.ts',
        test: {
          name: 'client',
          browser: {
            enabled: true,
            provider: playwright(),
            instances: [{ browser: 'chromium', headless: true }]
          },
          include: ['src/**/*.svelte.{test,spec}.{js,ts}'],
          exclude: ['src/lib/server/**'],
          setupFiles: ['src/test/setup-client.ts']
        }
      },

      {
        extends: './vite.config.ts',
        test: {
          name: 'server',
          environment: 'node',
          include: ['src/**/*.{test,spec}.{js,ts}'],
          exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
        }
      }
    ]
  }
});
