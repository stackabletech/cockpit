/**
 * i18n Compliance
 *
 * All user-visible strings must be served through Paraglide-JS message
 * functions so that the application renders correctly in both English (en)
 * and German (de).
 *
 * Rules:
 *   a) Both locale files (messages/en.json, messages/de.json) must have the
 *      same top-level keys — missing translations break the German locale.
 *   b) Svelte components must not use hardcoded English strings in static
 *      aria-label="..." attributes (dynamic bindings are allowed).
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { findFiles } from './helpers';

describe('i18n Compliance', () => {
  it('messages/en.json and messages/de.json must have the same top-level keys', () => {
    const en: Record<string, unknown> = JSON.parse(readFileSync('messages/en.json', 'utf-8'));
    const de: Record<string, unknown> = JSON.parse(readFileSync('messages/de.json', 'utf-8'));

    const enKeys = Object.keys(en).sort();
    const deKeys = Object.keys(de).sort();

    const missingInDe = enKeys.filter((k) => !deKeys.includes(k));
    const missingInEn = deKeys.filter((k) => !enKeys.includes(k));

    expect(missingInDe).toStrictEqual([]);
    expect(missingInEn).toStrictEqual([]);
  });

  it('Svelte components must not use static English strings in aria-label attributes', () => {
    const KNOWN_VIOLATIONS = [
      'ToastHost.svelte',
      'TextEditor.svelte',
      'ContextMenu.svelte',
      'FileRow.svelte',
      'FolderRow.svelte',
      'ObjectTable.svelte',
      'StorageBreadcrumb.svelte',
      'CsvPreview.svelte',
      'ParquetPreview.svelte',
      'TextPreview.svelte'
    ];

    const STATIC_ARIA_RE = /aria-label="[A-Za-z][^"]{2,}"/;

    const files = findFiles('src', /\.svelte$/);
    const allViolations = files.filter((file) => {
      const content = readFileSync(file, 'utf-8');
      return STATIC_ARIA_RE.test(content);
    });

    const newViolations = allViolations.filter(
      (f) => !KNOWN_VIOLATIONS.some((kv) => f.endsWith(kv))
    );
    expect(newViolations).toStrictEqual([]);
  });
});
