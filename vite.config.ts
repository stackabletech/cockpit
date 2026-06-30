import { paraglideVitePlugin } from '@inlang/paraglide-js';
import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import Icons from 'unplugin-icons/vite';
import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import path from 'node:path';

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
  resolve: {
    alias: [
      { find: 'typebox/compile', replacement: path.resolve('./src/stubs/typebox-compile.ts') },
      { find: 'typebox/format', replacement: path.resolve('./src/stubs/typebox-format.ts') },
      { find: 'typebox', replacement: path.resolve('./src/stubs/typebox.ts') }
    ]
  },
  optimizeDeps: {
    include: ['@sveltejs/kit', 'svelte']
  },
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
