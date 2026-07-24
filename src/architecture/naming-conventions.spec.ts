/**
 * Naming Conventions
 *
 * Consistent naming makes the codebase predictable and allows tooling
 * (SvelteKit, Vitest, ESLint) to apply the correct transforms automatically.
 *
 * Rules derived from AGENTS.md:
 *   • Svelte 5 rune-based stores use the `.svelte.ts` extension so that
 *     Svelte's compiler processes the rune syntax ($state, $derived, etc.)
 *   • Svelte components in src/lib/components/ are PascalCase (checked via fs
 *     because archunit does not scan .svelte files)
 */

import { projectFiles } from 'archunit';
import { describe, expect, it } from 'vitest';
import { defaultOptions, findFiles } from './helpers';

describe('Naming Conventions', () => {
  it('files in src/lib/stores/ must use the .svelte.ts extension', async () => {
    const rule = projectFiles().inPath('src/lib/stores/**').should().haveName('*.svelte.ts');

    await expect(rule).toPassAsync(defaultOptions);
  });

  it('Svelte components in src/lib/components/ must be PascalCase', () => {
    const PASCAL_CASE = /^[A-Z][a-zA-Z0-9]*\.svelte$/;
    const svelteFiles = findFiles('src/lib/components', /\.svelte$/, [/__tests__/, /\.spec\./]);

    const violations = svelteFiles.filter((f) => {
      const name = f.split('/').at(-1) ?? '';
      return !PASCAL_CASE.test(name);
    });

    expect(violations).toStrictEqual([]);
  });

  it('src/lib/server/ files must not use .svelte.ts extension', () => {
    const violations = findFiles('src/lib/server', /\.svelte\.ts$/);
    expect(violations).toStrictEqual([]);
  });
});
