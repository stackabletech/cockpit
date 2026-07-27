/**
 * No Circular Dependencies
 *
 * The `import-x/no-cycle` ESLint rule enforces cycle-free code across
 * `src/lib/**` and `src/routes/**` (excluding generated and known-cyclic
 * Trino files). See eslint.config.js for those checks.
 *
 * This test documents the remaining known violation in the Trino layer
 * so that it is removed when the cycles are finally resolved.
 *
 * Known violations (see TECH_DEBT.md — "Circular imports in Trino layer"):
 *   • src/lib/server/trino/client.ts  ↔  src/lib/server/trino/user-clients.ts
 *   • src/lib/server/trino/queries.ts ↔  src/lib/server/trino/result-collector.ts
 */

import { projectFiles } from 'archunit';
import { describe, expect, it } from 'vitest';

describe('No Circular Dependencies', () => {
  it('KNOWN VIOLATION — Trino layer has circular imports (see TECH_DEBT.md)', async () => {
    // This test DOCUMENTS the existing violations so they are visible in CI.
    // ESLint's `import-x/no-cycle` excludes `src/lib/server/trino/**` (see
    // eslint.config.js), so the cycles here are not caught by the linter.
    // When the cycles are resolved, delete this test and remove the
    // `src/lib/server/trino/**` exclusion from the ESLint config.
    //
    // Cycles to fix:
    //   client.ts ↔ user-clients.ts
    //   queries.ts ↔ result-collector.ts
    //
    // Fix: extract shared TypeScript interfaces (TrinoQuery, QueryState, etc.)
    // into a new src/lib/server/trino/types.ts file that neither side imports
    // back from its consumers.
    const rule = projectFiles().inPath('src/lib/server/trino/**/*.ts').should().haveNoCycles();

    const violations = await rule.check();
    expect(violations.length).toBeGreaterThan(0);
  });
});
