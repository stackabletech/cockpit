/**
 * UI Pattern Enforcement
 *
 * These rules enforce the coding standards from AGENTS.md that apply to Svelte
 * component files. They inspect raw file content via Node.js fs since ArchUnitTS
 * does not scan .svelte files.
 *
 * Rules:
 *   a) No hardcoded Tailwind colour utilities — use DaisyUI semantic classes
 *      so that light/dark theme switching works automatically.
 *   b) No raw <dialog> elements outside Modal.svelte — always use the shared
 *      <Modal> component which handles focus trapping, Escape, and backdrop.
 *   c) No native <input type="date"> / <input type="datetime-local"> — always
 *      use the shared <DateTimePicker> component.
 *   d) No <img> without an alt attribute — BITV 2.0 / WCAG 2.1 AA compliance.
 *   e) No <div onclick> / <span onclick> — use <button> for clickable elements.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkFiles, findFiles } from './helpers';

describe('UI Pattern Enforcement', () => {
  const HARDCODED_COLOUR_RE =
    /\b(bg-white|bg-black(?!\/)|text-gray-\d|text-slate-\d|bg-gray-\d|bg-slate-\d|border-gray-\d|border-slate-\d|text-zinc-\d|bg-zinc-\d)\b/;

  it('Svelte components must not use hardcoded Tailwind colour utilities', () => {
    const SIDEBAR_RE = /src\/lib\/components\/layout\/sidebar\//;

    const files = findFiles('src/lib/components', /\.svelte$/, [/__tests__/]);
    const violations: string[] = [];

    for (const file of files) {
      if (SIDEBAR_RE.test(file)) continue;
      const content = readFileSync(file, 'utf-8');
      if (HARDCODED_COLOUR_RE.test(content)) {
        violations.push(file);
      }
    }

    expect(violations).toStrictEqual([]);
  });

  it('Svelte components must not use raw <dialog> elements (use <Modal> instead)', () => {
    const violations = findFiles('src/lib/components', /\.svelte$/).filter((file) => {
      if (file.endsWith('Modal.svelte')) return false;
      const raw = readFileSync(file, 'utf-8');
      const stripped = raw
        .replace(/<!--[\s\S]*?-->/g, '')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//'))
        .join('\n');
      return /<dialog[\s>]/.test(stripped);
    });

    expect(violations).toStrictEqual([]);
  });

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
      const content = readFileSync(file, 'utf-8');
      return /<img(?![^>]*\balt=)[^>]*>/.test(content);
    });

    expect(violations).toStrictEqual([]);
  });

  it('clickable div/span elements must not replace <button> (BITV 2.0 keyboard nav)', () => {
    const KNOWN_VIOLATIONS = [
      'CatalogTree.svelte',
      'OperationsButton.svelte',
      'TabBar.svelte',
      'FloatingMenu.svelte',
      'StatementResult.svelte'
    ];

    const files = findFiles('src', /\.svelte$/);
    const allViolations = files.filter((file) => {
      const content = readFileSync(file, 'utf-8');
      return /<(div|span)[^>]+(on:click|onclick)=/.test(content);
    });

    const newViolations = allViolations.filter(
      (f) => !KNOWN_VIOLATIONS.some((kv) => f.endsWith(kv))
    );
    expect(newViolations).toStrictEqual([]);
  });
});
