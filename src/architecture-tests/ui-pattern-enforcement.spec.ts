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
 *   d) No text-base-content at 60% opacity or less (nor text-muted/NN) except on aria-hidden
 *      icon components — it fails WCAG AA contrast (4.5:1) in the light theme; use
 *      text-muted for secondary text.
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

  it('secondary text must use text-muted, not low base-content opacity (BITV 2.0 contrast)', () => {
    // text-muted is already tuned to the minimum; an opacity on top of it fails again
    const LOW_OPACITY = /text-base-content\/([1-5]\d|60)(?!\d)|text-muted\/\d+/g;
    // Icon components (<IconFolder>, <TypeIcon>) that are aria-hidden duplicate adjacent text
    const DECORATIVE_ICON = /^<(Icon\w*|\w*Icon)\b[^]*aria-hidden="true"/;
    const files = findFiles('src', /\.svelte$/);
    const violations = files.flatMap((file) => {
      const content = readTextFile(file);
      return [...content.matchAll(LOW_OPACITY)]
        .filter((match) => {
          // aria-hidden alone is no exemption: sighted users still read hidden text.
          // Skip '>' of arrow functions ('=>') when looking for the end of the tag.
          const start = content.lastIndexOf('<', match.index);
          let end = match.index;
          do end = content.indexOf('>', end + 1);
          while (end !== -1 && content[end - 1] === '=');
          return !DECORATIVE_ICON.test(content.slice(start, end + 1));
        })
        .map((match) => `${file}: ${match[0]}`);
    });

    expect(violations).toStrictEqual([]);
  });
});
