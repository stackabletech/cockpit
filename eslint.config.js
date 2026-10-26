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
  ...ts.configs.recommended,
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
    files: ['src/lib/components/Modal.svelte'],
    rules: { 'svelte/no-restricted-html-elements': 'off' }
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
              // The server re-exports the PUBLIC_ flags it enforces, so each is parsed once.
              except: ['./feature-flags.ts'],
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
