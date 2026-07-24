/**
 * Server-Side Logging Standards
 *
 * All server-side code must use pino (via $lib/server/logging) instead of
 * console.* so that logs are structured JSON, include request correlation IDs,
 * and can be filtered/routed by log level in production.
 *
 * Exceptions:
 *   • src/lib/server/migrate.ts — standalone CLI migration runner that executes
 *     before the application server and pino logger are initialised.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { findFiles } from './helpers';

describe('Server-Side Logging Standards', () => {
  it('server lib files must not call console.log/warn/error/info/debug', () => {
    const CONSOLE_CALL_RE = /\bconsole\.(log|warn|error|info|debug)\s*\(/;
    const COMMENT_LINE_RE = /^\s*(\/\/|\/\*|\*)/;

    const files = findFiles('src/lib/server', /\.ts$/).filter(
      (f) => !f.endsWith('migrate.ts') && !f.includes('.test.') && !f.includes('.spec.')
    );

    const violations: string[] = [];

    for (const file of files) {
      const lines = readFileSync(file, 'utf-8').split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (COMMENT_LINE_RE.test(line)) continue;
        if (!CONSOLE_CALL_RE.test(line)) continue;
        const matchIdx = line.search(CONSOLE_CALL_RE);
        const before = line.substring(0, matchIdx);
        const openDoubleQuotes = (before.match(/(?<!\\)"/g) ?? []).length;
        if (openDoubleQuotes % 2 !== 0) continue;
        const openSingleQuotes = (before.match(/(?<!\\)'/g) ?? []).length;
        if (openSingleQuotes % 2 !== 0) continue;
        if (line.includes('//') && line.indexOf('//') < matchIdx) continue;
        violations.push(`${file}:${i + 1}: ${line.trim()}`);
      }
    }

    expect(violations).toStrictEqual([]);
  });

  it('SvelteKit server route files must not call console.* directly', () => {
    const CONSOLE_CALL_RE = /\bconsole\.(log|warn|error|info|debug)\s*\(/;
    const COMMENT_OR_STRING_RE = /^\s*(\/\/|\/\*|\*)/;

    const files = findFiles('src/routes', /\.server\.ts$/);
    const violations: string[] = [];

    for (const file of files) {
      const lines = readFileSync(file, 'utf-8').split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (COMMENT_OR_STRING_RE.test(line)) continue;
        if (CONSOLE_CALL_RE.test(line) && !line.includes('//')) {
          violations.push(`${file}:${i + 1}: ${line.trim()}`);
        }
      }
    }

    expect(violations).toStrictEqual([]);
  });
});
