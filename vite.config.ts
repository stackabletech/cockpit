import { existsSync, readFileSync } from 'node:fs';
import { paraglideVitePlugin } from '@inlang/paraglide-js';
import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import Icons from 'unplugin-icons/vite';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';

export default defineConfig(({ mode }) => {
  // Load .env / .env.<mode> so the integrated-PoC switch is visible here (Vite does NOT put
  // .env vars into process.env at config-eval time).
  const env = loadEnv(mode, process.cwd(), '');

  // Integrated PoC (dev/integrated): when set (e.g. `cockpit.sdp.test`), bind 0.0.0.0 so the
  // in-cluster ingress can reach this dev server via the host gateway, serve HTTPS end-to-end
  // (SvelteKit's dev server ignores X-Forwarded-Proto, so better-auth's origin check needs the
  // dev server itself to be https), and route HMR over the ingress (wss on 443). Unset for
  // normal localhost:5173 development.
  const integratedHost = env.STACKABLE_COCKPIT_INTEGRATED_HOST;
  const certDir = 'dev/integrated/certs';
  const integratedHttps =
    integratedHost && existsSync(`${certDir}/sdp.crt`)
      ? { key: readFileSync(`${certDir}/sdp.key`), cert: readFileSync(`${certDir}/sdp.crt`) }
      : undefined;

  return {
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
    server: {
      allowedHosts: true,
      ...(integratedHost
        ? {
            host: true,
            https: integratedHttps,
            hmr: { protocol: 'wss', host: integratedHost, clientPort: 443 }
          }
        : {})
    },
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
  };
});
