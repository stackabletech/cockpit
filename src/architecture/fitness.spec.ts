/**
 * Architecture Fitness Functions
 *
 * These tests enforce the structural and quality constraints described in AGENTS.md.
 * They run separately from unit tests via `npm run test:arch` and are designed to
 * run in CI to catch architectural drift early.
 *
 * INTENT: Every rule here must remain GREEN on current code. If you are refactoring
 * a large file or fixing a known violation, update the threshold or add an exception
 * WITH a comment and a reference to the relevant TECH_DEBT.md entry.
 *
 * When adding a new feature, check that it does not violate any rule below.
 * If a rule needs a legitimate exception, add it explicitly with a comment explaining why.
 *
 * Run:     npm run test:arch
 * Reports: npm run test:arch:report  (generates HTML metrics dashboards in /reports)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RULE CATEGORIES
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. Server / Client Boundary     — server code must never leak to the client
 * 2. No Circular Dependencies     — prevent import cycles in lib and routes
 * 3. Naming Conventions           — file naming rules derived from AGENTS.md
 * 4. Code Size Limits             — prevent unbounded file growth
 * 5. UI Pattern Enforcement       — DaisyUI semantics, Modal, DateTimePicker
 * 6. Server-Side Logging          — prefer pino over console
 * 7. i18n Compliance              — locale files and aria-label hygiene
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * IMPLEMENTATION NOTE — archunit vs. Node.js fs rules
 * ArchUnitTS only scans TypeScript (.ts) source files. Svelte (.svelte) and
 * JSON files are invisible to its file graph. Rules in sections 5, 6, and 7
 * that need to inspect .svelte file content therefore use plain Node.js fs
 * helpers instead. Both styles produce the same pass/fail semantics.
 */

import { metrics, projectFiles } from 'archunit';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Standard options: suppress verbose logs, fail on empty patterns. */
const defaultOptions = {
  logging: { enabled: false, level: 'warn' as const }
};

/**
 * Recursively collect all files under `dir` whose names match `filenamePattern`.
 * Hidden directories (starting with `.`) are skipped automatically.
 */
function findFiles(dir: string, filenamePattern: RegExp, excludeDirs: RegExp[] = []): string[] {
  const results: string[] = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.')) continue;
      if (excludeDirs.some((p) => p.test(fullPath))) continue;
      results.push(...findFiles(fullPath, filenamePattern, excludeDirs));
    } else if (entry.isFile() && filenamePattern.test(entry.name)) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Check every file returned by `findFiles` against `predicate`.
 * Returns a list of `{ file, reason }` violation objects.
 */
function checkFiles(
  files: string[],
  predicate: (content: string) => boolean,
  reason: string
): Array<{ file: string; reason: string }> {
  return files
    .filter((file) => {
      const content = readFileSync(file, 'utf-8');
      return !predicate(content);
    })
    .map((file) => ({ file, reason }));
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. SERVER / CLIENT BOUNDARY
//
// The server layer (src/lib/server/**) contains database access, auth tokens,
// storage credentials, pino loggers and Prometheus metrics that must NEVER be
// bundled into the client. Any import of server code from client-side files is
// a security and build risk.
//
// Known legitimate cross-boundary pattern:
//   • Svelte component files (.svelte) may use `import type { … }` from server
//     type files. TypeScript erases these at compile time so there is no runtime
//     dependency. ArchUnitTS cannot distinguish type-only imports in .ts files,
//     but since it does not scan .svelte files anyway, this is not an issue here.
//     Long-term fix: move shared types to src/lib/types/ — see TECH_DEBT.md.
// ─────────────────────────────────────────────────────────────────────────────

describe('Server / Client Boundary', () => {
  it('client-only utilities (src/lib/client) must not import server code', async () => {
    const rule = projectFiles()
      .inPath('src/lib/client/**/*.ts')
      .shouldNot()
      .dependOnFiles()
      .inPath('src/lib/server/**');

    await expect(rule).toPassAsync(defaultOptions);
  });

  it('Svelte reactive stores (src/lib/stores) must not import server code', async () => {
    const rule = projectFiles()
      .inPath('src/lib/stores/**/*.ts')
      .shouldNot()
      .dependOnFiles()
      .inPath('src/lib/server/**');

    await expect(rule).toPassAsync(defaultOptions);
  });

  it('shared storage utilities (src/lib/storage) must not import server code', async () => {
    // src/lib/storage/ is the shared client-side storage state layer.
    // Server-side storage implementation lives in src/lib/server/storage/.
    const rule = projectFiles()
      .inPath('src/lib/storage/**/*.ts')
      .shouldNot()
      .dependOnFiles()
      .inPath('src/lib/server/**');

    await expect(rule).toPassAsync(defaultOptions);
  });

  it('Monaco/ANTLR editor code must not import server code', async () => {
    const rule = projectFiles()
      .inPath('src/lib/editor/**/*.ts', {
        // ANTLR-generated files are excluded from all rules.
        except: { inPath: 'src/lib/editor/generated/**' }
      })
      .shouldNot()
      .dependOnFiles()
      .inPath('src/lib/server/**');

    await expect(rule).toPassAsync(defaultOptions);
  });

  it('shared type definitions (src/lib/types) must not import server code', async () => {
    const rule = projectFiles()
      .inPath('src/lib/types/**/*.ts')
      .shouldNot()
      .dependOnFiles()
      .inPath('src/lib/server/**');

    await expect(rule).toPassAsync(defaultOptions);
  });

  it('server code must not import client-only utilities', async () => {
    // Prevents server-side code from accidentally depending on browser APIs
    // or client-side state management (e.g. Svelte stores).
    const rule = projectFiles()
      .inPath('src/lib/server/**/*.ts')
      .shouldNot()
      .dependOnFiles()
      .inPath('src/lib/client/**');

    await expect(rule).toPassAsync(defaultOptions);
  });

  it('server code must not import Svelte reactive stores', async () => {
    const rule = projectFiles()
      .inPath('src/lib/server/**/*.ts')
      .shouldNot()
      .dependOnFiles()
      .inPath('src/lib/stores/**');

    await expect(rule).toPassAsync(defaultOptions);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. NO CIRCULAR DEPENDENCIES
//
// Import cycles cause unpredictable initialisation order, make tree-shaking
// less effective and are a strong signal of coupled, hard-to-refactor code.
//
// Known violations (see TECH_DEBT.md — "Circular imports in Trino layer"):
//   • src/lib/server/trino/client.ts  ↔  src/lib/server/trino/user-clients.ts
//   • src/lib/server/trino/queries.ts ↔  src/lib/server/trino/result-collector.ts
//
// These are excluded from the cycle check below until the Trino layer is
// refactored to extract shared types into a separate file.
// ─────────────────────────────────────────────────────────────────────────────

describe('No Circular Dependencies', () => {
  it('src/lib must be free of import cycles (excluding generated and known-cyclic Trino files)', async () => {
    // TECH DEBT: The Trino sub-layer has two existing cycles (see above).
    // Exclude it until those are resolved; the dedicated Trino test below
    // documents the exact violation.
    const rule = projectFiles()
      .inPath('src/lib/**/*.ts', {
        except: {
          inPath: 'src/lib/editor/generated/**'
        }
      })
      .inPath('src/lib/**/*.ts', {
        except: {
          inPath: 'src/lib/server/trino/**'
        }
      })
      .should()
      .haveNoCycles();

    await expect(rule).toPassAsync(defaultOptions);
  });

  it('SvelteKit routes must be free of import cycles', async () => {
    const rule = projectFiles().inPath('src/routes/**/*.ts').should().haveNoCycles();

    await expect(rule).toPassAsync(defaultOptions);
  });

  it('KNOWN VIOLATION — Trino layer has circular imports (see TECH_DEBT.md)', async () => {
    // This test DOCUMENTS the existing violations so they are visible in CI.
    // When the cycles are resolved, delete this test and add the Trino path
    // back into the main cycle check above.
    //
    // Cycles to fix:
    //   client.ts ↔ user-clients.ts
    //   queries.ts ↔ result-collector.ts
    //
    // Fix: extract shared TypeScript interfaces (TrinoQuery, QueryState, etc.)
    // into a new src/lib/server/trino/types.ts file that neither side imports
    // back from its consumers.
    const rule = projectFiles().inPath('src/lib/server/trino/**/*.ts').should().haveNoCycles();

    // This is expected to fail until the Trino layer is refactored.
    const violations = await rule.check();
    expect(violations.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. NAMING CONVENTIONS
//
// Consistent naming makes the codebase predictable and allows tooling
// (SvelteKit, Vitest, ESLint) to apply the correct transforms automatically.
//
// Rules derived from AGENTS.md:
//   • Svelte 5 rune-based stores use the `.svelte.ts` extension so that
//     Svelte's compiler processes the rune syntax ($state, $derived, etc.)
//   • Svelte components in src/lib/components/ are PascalCase (checked via fs
//     because archunit does not scan .svelte files)
// ─────────────────────────────────────────────────────────────────────────────

describe('Naming Conventions', () => {
  it('files in src/lib/stores/ must use the .svelte.ts extension', async () => {
    // Svelte 5 rune-based reactive state ($state, $derived) only compiles
    // correctly when the file extension is .svelte.ts.
    const rule = projectFiles().inPath('src/lib/stores/**').should().haveName('*.svelte.ts');

    await expect(rule).toPassAsync(defaultOptions);
  });

  it('Svelte components in src/lib/components/ must be PascalCase', () => {
    // PascalCase distinguishes reusable components from SvelteKit route files
    // (+page.svelte etc.) and makes auto-import tooling reliable.
    // Note: spec files (*.svelte.spec.ts / *.spec.ts) inside __tests__/ are
    // excluded because they follow a different naming convention.
    const PASCAL_CASE = /^[A-Z][a-zA-Z0-9]*\.svelte$/;
    const svelteFiles = findFiles('src/lib/components', /\.svelte$/, [/__tests__/, /\.spec\./]);

    const violations = svelteFiles.filter((f) => {
      const name = f.split('/').at(-1) ?? '';
      return !PASCAL_CASE.test(name);
    });

    expect(violations).toStrictEqual([]);
  });

  it('src/lib/server/ files must not use .svelte.ts extension', () => {
    // Server-only code must not use the .svelte.ts extension since that
    // extension tells the Svelte compiler to process the file. Server code
    // should use plain .ts files.
    const violations = findFiles('src/lib/server', /\.svelte\.ts$/);
    expect(violations).toStrictEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. CODE SIZE LIMITS
//
// Very large files are a leading indicator of insufficient separation of
// concerns and increase cognitive load for both humans and AI coding assistants.
//
// Thresholds are set above current maximums to pass today but act as guardrails
// against further growth. Tighten them as large files are split during normal
// refactoring cycles.
//
// Current maximums (non-generated):
//   src/lib/storage/state.svelte.ts              ~2 331 LOC  ← split candidate
//   src/lib/server/storage/archive.ts              ~919 LOC
//   src/lib/components/storage/modals/PreviewModal.svelte ~1 065 LOC
// ─────────────────────────────────────────────────────────────────────────────

describe('Code Size Limits', () => {
  it('TypeScript source files must not exceed 2 400 lines of code', () => {
    // TECH DEBT: src/lib/storage/state.svelte.ts is ~2 331 LOC.
    // Target: split into smaller focused modules and lower threshold to 600.
    //
    // Note: archunit's metrics().count().linesOfCode() requires TypeScript
    // compiler access which is not available in the standalone vitest.arch.config.ts
    // context. We use a direct Node.js fs line-count instead.
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
    // TECH DEBT: PreviewModal.svelte is ~1 065 LOC.
    // Target: extract preview-type sub-components and lower threshold to 350.
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

// ─────────────────────────────────────────────────────────────────────────────
// 5. UI PATTERN ENFORCEMENT
//
// These rules enforce the coding standards from AGENTS.md that apply to Svelte
// component files. They inspect raw file content via Node.js fs since ArchUnitTS
// does not scan .svelte files.
//
// Rules:
//   a) No hardcoded Tailwind colour utilities — use DaisyUI semantic classes
//      so that light/dark theme switching works automatically.
//   b) No raw <dialog> elements outside Modal.svelte — always use the shared
//      <Modal> component which handles focus trapping, Escape, and backdrop.
//   c) No native <input type="date"> / <input type="datetime-local"> — always
//      use the shared <DateTimePicker> component.
//   d) No <img> without an alt attribute — BITV 2.0 / WCAG 2.1 AA compliance.
//   e) No <div onclick> / <span onclick> — use <button> for clickable elements.
// ─────────────────────────────────────────────────────────────────────────────

describe('UI Pattern Enforcement', () => {
  /**
   * Hard-coded Tailwind colour classes that must not appear in components.
   * Matches class attribute values containing the forbidden tokens.
   * bg-black/30 is intentionally excluded — see the exception in the test below.
   */
  const HARDCODED_COLOUR_RE =
    /\b(bg-white|bg-black(?!\/)|text-gray-\d|text-slate-\d|bg-gray-\d|bg-slate-\d|border-gray-\d|border-slate-\d|text-zinc-\d|bg-zinc-\d)\b/;

  it('Svelte components must not use hardcoded Tailwind colour utilities', () => {
    // Use DaisyUI semantic classes (bg-base-100, text-base-content, etc.) so
    // that light ↔ dark theme switching works without code changes.
    // See: AGENTS.md → "CSS & Styling"
    //
    // Exception: src/lib/components/layout/sidebar/ uses bg-black/30 for a
    // translucent backdrop overlay. The /30 opacity modifier is intentional
    // and bg-black without a modifier is blocked by the regex above.
    // Tracked in TECH_DEBT.md.
    const SIDEBAR_RE = /src\/lib\/components\/layout\/sidebar\//;

    const files = findFiles('src/lib/components', /\.svelte$/, [/__tests__/]);
    const violations: string[] = [];

    for (const file of files) {
      if (SIDEBAR_RE.test(file)) continue; // known exception
      const content = readFileSync(file, 'utf-8');
      if (HARDCODED_COLOUR_RE.test(content)) {
        violations.push(file);
      }
    }

    expect(violations).toStrictEqual([]);
  });

  it('Svelte components must not use raw <dialog> elements (use <Modal> instead)', () => {
    // Raw <dialog> bypasses the shared Modal component which handles:
    //   • focus trapping, backdrop click-to-close, Escape key (Firefox fix)
    //   • consistent styling, animation, and accessibility attributes
    // Exception: Modal.svelte IS the canonical implementation of <Modal>.
    // Note: we strip single-line JS comments and HTML comments before checking
    // to avoid false positives from comment text like "moves into the <dialog>".
    const violations = findFiles('src/lib/components', /\.svelte$/).filter((file) => {
      if (file.endsWith('Modal.svelte')) return false;
      const raw = readFileSync(file, 'utf-8');
      // Remove HTML comments (<!-- ... -->) and JS single-line comments (//...)
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
    // Native date/time inputs have inconsistent cross-browser styling and no
    // dark-mode support. Always use the shared <DateTimePicker> component.
    // See: AGENTS.md → "Code Style & Best Practices"
    const files = findFiles('src', /\.svelte$/);
    const violations = checkFiles(
      files,
      (content) => !/type="date"|type="datetime-local"/.test(content),
      'must not use native date/datetime-local inputs — use <DateTimePicker> instead'
    );

    expect(violations).toStrictEqual([]);
  });

  it('img elements in Svelte components must have an alt attribute (BITV 2.0)', () => {
    // Every <img> must have a meaningful alt attribute (or alt="" for
    // decorative images). This is required by BITV 2.0 / WCAG 2.1 SC 1.1.1.
    const files = findFiles('src', /\.svelte$/);
    const violations = files.filter((file) => {
      const content = readFileSync(file, 'utf-8');
      // Match <img> tags that do NOT contain an alt attribute.
      return /<img(?![^>]*\balt=)[^>]*>/.test(content);
    });

    expect(violations).toStrictEqual([]);
  });

  it('clickable div/span elements must not replace <button> (BITV 2.0 keyboard nav)', () => {
    // Using <div onclick> / <span onclick> instead of <button> prevents
    // keyboard navigation and breaks screen readers (BITV 2.0).
    // Use <button type="button"> for clickable elements without navigation.
    //
    // Note: this catches Svelte 5 `onclick={…}` and legacy `on:click={…}`.
    // The regex uses [^>]+ which crosses newlines (Svelte multi-line attributes).
    //
    // KNOWN VIOLATIONS — these pre-existing files use <div onclick> patterns.
    // They are tracked here so that NEW violations are caught immediately.
    // Fix: replace the interactive <div>/<span> with <button role="treeitem"> or
    // restructure to use a semantic element. See TECH_DEBT.md.
    const KNOWN_VIOLATIONS = [
      'CatalogTree.svelte', // tree node rows use <div onclick>
      'OperationsButton.svelte', // operation list rows use <div onclick>
      'TabBar.svelte', // custom tab bar items use <div onclick>
      'FloatingMenu.svelte', // portal overlay uses <div onclick>
      'StatementResult.svelte' // result table rows use <div onclick>
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

// ─────────────────────────────────────────────────────────────────────────────
// 6. SERVER-SIDE LOGGING STANDARDS
//
// All server-side code must use pino (via $lib/server/logging) instead of
// console.* so that logs are structured JSON, include request correlation IDs,
// and can be filtered/routed by log level in production.
//
// Exceptions:
//   • src/lib/server/migrate.ts — standalone CLI migration runner that executes
//     before the application server and pino logger are initialised.
// ─────────────────────────────────────────────────────────────────────────────

describe('Server-Side Logging Standards', () => {
  it('server lib files must not call console.log/warn/error/info/debug', () => {
    // Use the pino logger instead:
    //   Request-scoped: const log = event.locals.logger;
    //   Module-level:   const log = logger.child({ module: 'my-module' });
    // See: AGENTS.md → "Logging"
    //
    // Exclusions:
    //   • migrate.ts — standalone CLI script, pino is not yet initialised
    //   • *.test.ts / *.spec.ts — test fixture data may contain console.log
    //     strings (e.g. as mock output to assert against)
    //
    // The string-in-quotes check skips lines where console.log appears inside
    // a string literal (e.g. error messages that show example commands).
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
        // Skip if console.log is inside a string literal:
        // count unescaped double-quotes before the match to determine quoting context.
        const matchIdx = line.search(CONSOLE_CALL_RE);
        const before = line.substring(0, matchIdx);
        const openDoubleQuotes = (before.match(/(?<!\\)"/g) ?? []).length;
        if (openDoubleQuotes % 2 !== 0) continue; // inside a double-quoted string
        const openSingleQuotes = (before.match(/(?<!\\)'/g) ?? []).length;
        if (openSingleQuotes % 2 !== 0) continue; // inside a single-quoted string
        // Skip inline trailing comments that contain console (e.g. // console.log example)
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

// ─────────────────────────────────────────────────────────────────────────────
// 7. i18n COMPLIANCE
//
// All user-visible strings must be served through Paraglide-JS message
// functions so that the application renders correctly in both English (en)
// and German (de).
//
// Rules:
//   a) Both locale files (messages/en.json, messages/de.json) must have the
//      same top-level keys — missing translations break the German locale.
//   b) Svelte components must not use hardcoded English strings in static
//      aria-label="..." attributes (dynamic bindings are allowed).
// ─────────────────────────────────────────────────────────────────────────────

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
    // aria-label values must come from m.*() message functions so screen
    // reader users hear localised text in both supported locales.
    //
    // aria-label="some text"   ← FORBIDDEN  (hardcoded English)
    // aria-label={m.foo()}     ← ALLOWED    (i18n function call)
    // aria-label="{m.foo()}"   ← ALLOWED    (Svelte template interpolation)
    //
    // The regex catches aria-label="..." with a plain quoted string value
    // (at least 3 chars, starts with a letter). Template bindings with
    // curly braces are excluded.
    //
    // KNOWN VIOLATIONS — pre-existing components with hardcoded aria-label strings.
    // When you fix one of these files, remove it from KNOWN_VIOLATIONS so that the
    // list stays accurate and prevents regressions. See TECH_DEBT.md.
    const KNOWN_VIOLATIONS = [
      'ToastHost.svelte', // aria-label="Notifications"
      'TextEditor.svelte', // aria-label for editor toolbar actions
      'ContextMenu.svelte', // aria-label="Context menu"
      'FileRow.svelte', // aria-label for file action buttons
      'FolderRow.svelte', // aria-label for folder action buttons
      'ObjectTable.svelte', // aria-label for table column headers
      'StorageBreadcrumb.svelte', // aria-label="Breadcrumb navigation"
      'CsvPreview.svelte', // aria-label for preview controls
      'ParquetPreview.svelte', // aria-label for preview controls
      'TextPreview.svelte' // aria-label for preview controls
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

// ─────────────────────────────────────────────────────────────────────────────
// REPORT GENERATION
//
// Run `npm run test:arch:report` to generate HTML dashboards in /reports/.
// These can be committed as CI artefacts for architecture review.
// ─────────────────────────────────────────────────────────────────────────────

describe('Architecture Reports (run manually with test:arch:report)', () => {
  it('should export dependency graph for src/lib', async () => {
    // This test always passes — it is only meaningful when run with
    // `npm run test:arch:report` which sets ARCH_REPORT=1.
    if (!process.env.ARCH_REPORT) {
      expect(true).toBe(true);
      return;
    }

    const { projectGraph } = await import('archunit');
    await projectGraph()
      .titled('Stackable Cockpit — src/lib Dependency Graph')
      .focusOn('src/lib/**', 2)
      .exportAsHTML('reports/lib-dependency-graph.html');

    await projectGraph()
      .titled('Stackable Cockpit — Full Source Graph')
      .collapseToFolderDepth(3)
      .exportAsMermaid('reports/source-graph.mmd');

    expect(true).toBe(true);
  });

  it('should export code metrics report', async () => {
    if (!process.env.ARCH_REPORT) {
      expect(true).toBe(true);
      return;
    }

    await metrics()
      .inPath('src/**/*.ts', {
        except: { inPath: 'src/lib/editor/generated/**' }
      })
      .count()
      .exportAsHTML('reports/count-metrics.html', {
        title: 'Stackable Cockpit — Count Metrics',
        includeTimestamp: true
      });

    expect(true).toBe(true);
  });
});
