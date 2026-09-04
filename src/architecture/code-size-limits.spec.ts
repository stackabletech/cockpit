/**
 * Code Size Limits
 *
 * Very large files are a leading indicator of insufficient separation of
 * concerns and increase cognitive load for both humans and AI coding assistants.
 *
 * Thresholds are set above current maximums to pass today but act as guardrails
 * against further growth. Tighten them as large files are split during normal
 * refactoring cycles.
 *
 * Current maximums (non-generated):
 *   src/lib/storage/state.svelte.ts              ~2 331 LOC  ← split candidate
 *   src/lib/server/storage/archive.ts              ~919 LOC
 *   src/lib/components/storage/modals/PreviewModal.svelte ~1 065 LOC
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { findFiles } from './helpers';

describe('Code Size Limits', () => {
  it('TypeScript source files must not exceed 2 400 lines of code', () => {
    const MAX_LOC = 2400;
    const violations: string[] = [];

    const files = findFiles('src', /\.ts$/, [/editor\/generated/, /paraglide/]);
    for (const file of files) {
      const lines = readFileSync(file, 'utf-8').split('\n').length;
      if (lines >= MAX_LOC) {
        violations.push(`${file} (${lines} lines, max ${MAX_LOC})`);
      }
    }

    expect(violations).toStrictEqual([]);
  });

  it('Svelte component files must not exceed 1 100 lines', () => {
    const MAX_LOC = 1100;
    const violations: string[] = [];

    const files = findFiles('src', /\.svelte$/);
    for (const file of files) {
      const lines = readFileSync(file, 'utf-8').split('\n').length;
      if (lines >= MAX_LOC) {
        violations.push(`${file} (${lines} lines, max ${MAX_LOC})`);
      }
    }

    expect(violations).toStrictEqual([]);
  });

  it('individual test files must not exceed 1 000 lines of code', () => {
    const MAX_LOC = 1000;
    const violations: string[] = [];

    const files = findFiles('src', /\.(test|spec)\.ts$/, [/editor\/generated/]);
    for (const file of files) {
      const lines = readFileSync(file, 'utf-8').split('\n').length;
      if (lines >= MAX_LOC) {
        violations.push(`${file} (${lines} lines, max ${MAX_LOC})`);
      }
    }

    expect(violations).toStrictEqual([]);
  });
});
