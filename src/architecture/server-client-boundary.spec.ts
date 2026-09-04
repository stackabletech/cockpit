/**
 * Server / Client Boundary
 *
 * The server layer (src/lib/server/**) contains database access, auth tokens,
 * storage credentials, pino loggers and Prometheus metrics that must NEVER be
 * bundled into the client. Any import of server code from client-side files is
 * a security and build risk.
 *
 * Known legitimate cross-boundary pattern:
 *   • Svelte component files (.svelte) may use `import type { … }` from server
 *     type files. TypeScript erases these at compile time so there is no runtime
 *     dependency. ArchUnitTS cannot distinguish type-only imports in .ts files,
 *     but since it does not scan .svelte files anyway, this is not an issue here.
 *     Long-term fix: move shared types to src/lib/types/ — see TECH_DEBT.md.
 */

import { projectFiles } from 'archunit';
import { describe, expect, it } from 'vitest';
import { defaultOptions } from './helpers';

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
