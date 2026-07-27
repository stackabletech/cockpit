import prettier from 'eslint-config-prettier';
import js from '@eslint/js';
import { includeIgnoreFile } from '@eslint/compat';
import svelte from 'eslint-plugin-svelte';
import betterTailwindcss from 'eslint-plugin-better-tailwindcss';
import importx from 'eslint-plugin-import-x';
import security from 'eslint-plugin-security';
import globals from 'globals';
import { fileURLToPath } from 'node:url';
import ts from 'typescript-eslint';

const gitignorePath = fileURLToPath(new URL('./.gitignore', import.meta.url));

export default ts.config(
  includeIgnoreFile(gitignorePath),
  { ignores: ['src/lib/editor/generated/**', '.github/skills/**'] },
  js.configs.recommended,
  ...ts.configs.recommended,
  ...svelte.configs.recommended,
  { ...security.configs.recommended, files: ['**/*.ts'] },
  prettier,
  ...svelte.configs.prettier,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node }
    },
    rules: {
      'no-undef': 'off',
      // It will currently also error on external links or links with query parameters
      // https://github.com/sveltejs/eslint-plugin-svelte/issues/1353
      'svelte/no-navigation-without-resolve': 'warn'
    }
  },
  {
    files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        extraFileExtensions: ['.svelte'],
        parser: ts.parser
      }
    }
  },
  {
    files: ['src/**/*.svelte'],
    plugins: { 'better-tailwindcss': betterTailwindcss },
    settings: {
      'better-tailwindcss': {
        entryPoint: 'src/app.css'
      }
    },
    rules: {
      'better-tailwindcss/no-unknown-classes': ['warn', { detectComponentClasses: true }]
    }
  },

  // ── Architecture fitness: server / client boundary ───────────────────────
  {
    plugins: { 'import-x': importx },
    rules: {
      'import-x/no-restricted-paths': [
        'error',
        {
          zones: [
            { target: 'src/lib/client', from: 'src/lib/server' },
            { target: 'src/lib/stores', from: 'src/lib/server' },
            { target: 'src/lib/storage', from: 'src/lib/server' },
            { target: 'src/lib/editor', from: 'src/lib/server' },
            { target: 'src/lib/types', from: 'src/lib/server' },
            { target: 'src/lib/server', from: 'src/lib/client' },
            { target: 'src/lib/server', from: 'src/lib/stores' }
          ]
        }
      ]
    }
  },

  // ── Architecture fitness: no circular dependencies ───────────────────────
  // (except the "KNOWN VIOLATION" test which remains in arch tests)
  {
    files: ['src/lib/**/*.ts'],
    ignores: ['src/lib/editor/generated/**', 'src/lib/server/trino/**'],
    rules: {
      'import-x/no-cycle': 'error'
    }
  },
  {
    files: ['src/routes/**/*.ts'],
    rules: {
      'import-x/no-cycle': 'error'
    }
  },

  // ── Architecture fitness: code size limits ──────────────────────────────
  {
    files: ['src/**/*.ts'],
    ignores: ['src/lib/editor/generated/**', 'src/lib/paraglide/**'],
    rules: {
      'max-lines': ['error', { max: 2400 }]
    }
  },
  {
    files: ['src/**/*.svelte'],
    rules: {
      'max-lines': ['error', { max: 1100 }]
    }
  },
  {
    files: ['src/**/*.{test,spec}.ts'],
    rules: {
      'max-lines': ['error', { max: 1000 }]
    }
  },

  // ── Architecture fitness: server-side logging ───────────────────────────
  {
    files: ['src/lib/server/**/*.ts', 'src/routes/**/*.server.ts'],
    ignores: ['**/migrate.ts', '**/*.{test,spec}.ts'],
    rules: {
      'no-console': 'error'
    }
  }
);
