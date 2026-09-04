/**
 * No Circular Dependencies
 *
 * Import cycles cause unpredictable initialisation order, make tree-shaking
 * less effective and are a strong signal of coupled, hard-to-refactor code.
 *
 * Known violations (see TECH_DEBT.md — "Circular imports in Trino layer"):
 *   • src/lib/server/trino/client.ts  ↔  src/lib/server/trino/user-clients.ts
 *   • src/lib/server/trino/queries.ts ↔  src/lib/server/trino/result-collector.ts
 *
 * These are excluded from the cycle check below until the Trino layer is
 * refactored to extract shared types into a separate file.
 */

import { projectFiles } from 'archunit';
import { describe, expect, it } from 'vitest';
import { defaultOptions } from './helpers';

describe('No Circular Dependencies', () => {
  it('src/lib must be free of import cycles (excluding generated and known-cyclic Trino files)', async () => {
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
    const rule = projectFiles().inPath('src/lib/server/trino/**/*.ts').should().haveNoCycles();

    const violations = await rule.check();
    expect(violations.length).toBeGreaterThan(0);
  });
});
