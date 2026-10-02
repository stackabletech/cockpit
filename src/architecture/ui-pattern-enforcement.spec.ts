/**
 * UI Pattern Enforcement
 *
 * These rules enforce the coding standards from AGENTS.md that apply to Svelte
 * component files. They inspect raw file content via Node.js fs since ArchUnitTS
 * does not scan .svelte files.
 *
 * Rules:
 *   a) No native <input type="date"> / <input type="datetime-local"> — always
 *      use the shared <DateTimePicker> component.
 *   b) No <img> without an alt attribute — BITV 2.0 / WCAG 2.1 AA compliance.
 *   c) No <div onclick> / <span onclick> — use <button> for clickable elements.
 */

import { describe, expect, it } from 'vitest';
import { checkFiles, findFiles, readTextFile } from './helpers';

describe('UI Pattern Enforcement', () => {
  it('Svelte components must not use native date/time inputs (use <DateTimePicker>)', () => {
    const files = findFiles('src', /\.svelte$/);
    const violations = checkFiles(
      files,
      (content) => !/type="date"|type="datetime-local"/.test(content),
      'must not use native date/datetime-local inputs — use <DateTimePicker> instead'
    );

    expect(violations).toStrictEqual([]);
  });

  it('img elements in Svelte components must have an alt attribute (BITV 2.0)', () => {
    const files = findFiles('src', /\.svelte$/);
    const violations = files.filter((file) => {
      const content = readTextFile(file);
      return /<img(?![^>]*\balt=)[^>]*>/.test(content);
    });

    expect(violations).toStrictEqual([]);
  });

  it('clickable div/span elements must not replace <button> (BITV 2.0 keyboard nav)', () => {
    const KNOWN_VIOLATION_PATHS = [
      'src/lib/components/catalog/CatalogTree.svelte',
      'src/lib/components/storage/explorer/OperationsButton.svelte',
      'src/lib/components/TabBar.svelte',
      'src/lib/components/storage/shared/FloatingMenu.svelte',
      'src/lib/components/trino/StatementResult.svelte'
    ];

    const files = findFiles('src', /\.svelte$/);
    const allViolations = files.filter((file) => {
      const content = readTextFile(file);
      return /<(div|span)[^>]+(on:click|onclick)=/.test(content);
    });

    const newViolations = allViolations.filter((f) => !KNOWN_VIOLATION_PATHS.includes(f));
    expect(newViolations).toStrictEqual([]);
  });
});
