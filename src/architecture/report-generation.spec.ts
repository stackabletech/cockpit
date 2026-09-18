/**
 * Architecture Reports
 *
 * Run `npm run test:arch:report` to generate HTML dashboards in /reports/.
 * These can be committed as CI artefacts for architecture review.
 */

import { describe, expect, it } from 'vitest';

describe('Architecture Reports (run manually with test:arch:report)', () => {
  it('should export dependency graph for src/lib', async () => {
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

    const { metrics } = await import('archunit');
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
