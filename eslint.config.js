import prettier from 'eslint-config-prettier';
import js from '@eslint/js';
import { includeIgnoreFile } from '@eslint/compat';
import { defineConfig } from 'eslint/config';
import svelte from 'eslint-plugin-svelte';
import betterTailwindcss from 'eslint-plugin-better-tailwindcss';
import security from 'eslint-plugin-security';
import importPlugin from 'eslint-plugin-import';
import checkFile from 'eslint-plugin-check-file';
import globals from 'globals';
import { fileURLToPath } from 'node:url';
import ts from 'typescript-eslint';

const gitignorePath = fileURLToPath(new URL('./.gitignore', import.meta.url));

export default defineConfig(
  includeIgnoreFile(gitignorePath),
  { ignores: ['src/lib/editor/generated/**'] },
  js.configs.recommended,
  ...ts.configs.recommendedTypeChecked,
  ...svelte.configs.recommended,
  { ...security.configs.recommended, files: ['**/*.ts'] },
  prettier,
  ...svelte.configs.prettier,
  {
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    languageOptions: {
      globals: { ...globals.browser, ...globals.node }
    },
    rules: {
      'no-undef': 'off',
      // linterOptions.reportUnusedDisableDirectives does not cover comments in Svelte templates.
      'svelte/comment-directive': ['error', { reportUnusedDisableDirectives: true }],
      'no-console': 'error',
      // It will currently also error on external links or links with query parameters.
      // https://github.com/sveltejs/eslint-plugin-svelte/issues/1353
      'svelte/no-navigation-without-resolve': 'error',
      'svelte/no-restricted-html-elements': [
        'error',
        { elements: ['dialog'], message: 'Use the shared Modal component instead of <dialog>.' }
      ],
      // Flags every computed member access; nearly all hits are array indices or typed Record lookups.
      'security/detect-object-injection': 'off'
    }
  },
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          // Root config files that no tsconfig includes.
          allowDefaultProject: [
            'drizzle.config.ts',
            'playwright.config.ts',
            'vitest.arch.config.ts'
          ]
        },
        extraFileExtensions: ['.svelte'],
        parser: ts.parser
      }
    },
    rules: {
      // Untyped JSON, third-party data and test mocks make up nearly all of the ~1,000 hits;
      // svelte-check with `strict` already covers the typed code. See #411.
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      // Mostly async functions that implement an async interface without awaiting; style, not bugs.
      '@typescript-eslint/require-await': 'off'
    }
  },
  {
    // Plain JS files (root configs, server.js, CLI scripts) are outside every tsconfig.
    files: ['**/*.js', '**/*.mjs'],
    ...ts.configs.disableTypeChecked
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
      'better-tailwindcss/no-unknown-classes': [
        'warn',
        {
          detectComponentClasses: true,
          ignore: [
            'dropdown-content',
            'dropdown-open',
            'swap-on',
            'swap-off',
            'label-text',
            'menu-disabled',
            'tab-active',
            'tab-strip',
            'preview-scroll',
            'modal-top-search',
            'table-pin-rows'
          ]
        }
      ],
      'better-tailwindcss/no-restricted-classes': [
        'error',
        {
          restrict: [
            '^(bg-white|bg-black|text-(gray|slate|zinc)-\\d+|bg-(gray|slate|zinc)-\\d+|border-(gray|slate)-\\d+)$'
          ]
        }
      ]
    }
  },
  {
    // CLI scripts and E2E helper processes that run without the app's logger.
    files: ['e2e/support/**/*.ts', 'src/lib/editor/grammar/patch-generated.mjs'],
    rules: { 'no-console': 'off' }
  },
  {
    // Tests read and write fixtures and temp files they create themselves.
    files: ['**/*.{test,spec}.ts', 'e2e/**/*.ts', 'src/architecture-tests/**/*.ts'],
    rules: { 'security/detect-non-literal-fs-filename': 'off' }
  },
  {
    files: ['**/*.{test,spec}.ts', '**/*.test-utils.ts'],
    rules: {
      // `expect(mock.method).toHaveBeenCalled()` passes methods around unbound by design.
      '@typescript-eslint/unbound-method': 'off',
      // Async `mockImplementation()`s for mocks typed with a void return.
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { arguments: false } }
      ]
    }
  },
  {
    files: ['src/**/*.ts'],
    ignores: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
    rules: { 'max-lines': ['error', { max: 2400, skipBlankLines: false, skipComments: false }] }
  },
  {
    files: ['src/**/*.svelte'],
    rules: { 'max-lines': ['error', { max: 1200, skipBlankLines: false, skipComments: false }] }
  },
  {
    files: ['src/**/*.{test,spec}.ts'],
    rules: { 'max-lines': ['error', { max: 1000, skipBlankLines: false, skipComments: false }] }
  },
  {
    files: [
      'src/lib/stores/**/*.{ts,svelte.ts}',
      'src/lib/components/**/*.svelte',
      'src/lib/server/**/*.svelte.ts'
    ],
    plugins: { 'check-file': checkFile },
    rules: {
      'check-file/filename-naming-convention': [
        'error',
        {
          'src/lib/components/**/!(*.spec).svelte': 'PASCAL_CASE'
        }
      ],
      'check-file/filename-blocklist': [
        'error',
        {
          'src/lib/stores/**/!(*.svelte|*.spec).ts': '*.svelte.ts',
          'src/lib/server/**/*.svelte.ts': '*.ts'
        }
      ]
    }
  },
  {
    files: ['src/lib/components/ui/Modal.svelte'],
    rules: { 'svelte/no-restricted-html-elements': 'off' }
  },
  {
    // Touching Web Storage throws when the browser blocks site data, and a throw during hydration
    // takes down the whole app. The helpers in local-storage.ts catch that.
    files: ['src/**/*.{ts,svelte}'],
    ignores: ['src/lib/client/local-storage.ts', 'src/**/*.{test,spec}.ts', 'src/test/**'],
    rules: {
      'no-restricted-globals': [
        'error',
        ...['localStorage', 'sessionStorage'].map((name) => ({
          name,
          message: 'Use the helpers in $lib/client/local-storage instead.'
        }))
      ],
      'no-restricted-properties': [
        'error',
        ...['localStorage', 'sessionStorage'].map((property) => ({
          object: 'window',
          property,
          message: 'Use the helpers in $lib/client/local-storage instead.'
        }))
      ]
    }
  },
  {
    // Generic building blocks: everything comes in through props, so they must not depend on app
    // state, routing or feature modules (see "Component Layers" in AGENTS.md).
    files: ['src/lib/components/ui/**/*.{svelte,ts}'],
    // Specs may load the global stylesheet to test against the real styles.
    ignores: ['src/lib/components/ui/**/*.spec.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['$lib/*', '!$lib/paraglide', '!$lib/types', '!$lib/components'],
              message: 'ui/ components may only import Paraglide messages, shared types and ui/.'
            },
            {
              group: ['$lib/components/*', '!$lib/components/ui'],
              message: 'ui/ components must not import app or feature components.'
            },
            {
              group: ['$app/*'],
              message: 'ui/ components must not depend on SvelteKit app state.'
            },
            { group: ['../*'], message: 'ui/ components must not import from outside ui/.' }
          ]
        }
      ]
    }
  },
  {
    files: [
      'src/lib/client/**/*.ts',
      'src/lib/stores/**/*.ts',
      'src/lib/storage/**/*.ts',
      'src/lib/editor/**/*.ts',
      'src/lib/types/**/*.ts'
    ],
    plugins: { import: importPlugin },
    settings: { 'import/resolver': { typescript: true } },
    rules: {
      'import/no-restricted-paths': [
        'error',
        {
          zones: [
            {
              target: './src/lib',
              from: './src/lib/server',
              message: 'Client-side code must not import server code.'
            }
          ]
        }
      ]
    }
  },
  {
    files: ['src/lib/server/**/*.ts'],
    plugins: { import: importPlugin },
    settings: { 'import/resolver': { typescript: true } },
    rules: {
      'import/no-restricted-paths': [
        'error',
        {
          zones: [
            {
              target: './src/lib/server',
              from: './src/lib/client',
              // The server re-exports the PUBLIC_ flags and config it enforces, so each is parsed once.
              except: ['./feature-flags.ts', './config.ts'],
              message: 'Server code must not import client-only utilities.'
            },
            {
              target: './src/lib/server',
              from: './src/lib/stores',
              message: 'Server code must not import Svelte stores.'
            }
          ]
        }
      ]
    }
  }
);
