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
  { ignores: ['src/lib/editor/generated/**', 'src/lib/server/migrate.ts', 'e2e/support/**'] },
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
      'no-console': 'off',
      // It will currently also error on external links or links with query parameters.
      // https://github.com/sveltejs/eslint-plugin-svelte/issues/1353
      'svelte/no-navigation-without-resolve': 'warn',
      'svelte/no-restricted-html-elements': [
        'error',
        { elements: ['dialog'], message: 'Use the shared Modal component instead of <dialog>.' }
      ],
      // Too common occurrence in this project, disabling for now.
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
            'preview-scroll'
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
    files: ['src/lib/server/**/*.ts', 'src/routes/**/*.server.ts'],
    rules: { 'no-console': 'error' }
  },
  {
    files: ['src/**/*.ts'],
    ignores: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
    rules: { 'max-lines': ['error', { max: 2400, skipBlankLines: false, skipComments: false }] }
  },
  {
    files: ['src/**/*.svelte'],
    rules: { 'max-lines': ['error', { max: 1100, skipBlankLines: false, skipComments: false }] }
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
      'src/lib/components/layout/sidebar/Sidebar.svelte',
      'src/lib/components/storage/landing/RecentItems.svelte',
      'src/routes/**/edit/+page.svelte',
      'src/routes/(app)/storage/+layout.svelte'
    ],
    rules: { 'svelte/no-navigation-without-resolve': 'off' }
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
