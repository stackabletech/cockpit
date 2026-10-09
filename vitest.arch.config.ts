/**
 * Vitest configuration for architecture fitness functions.
 *
 * This is a separate configuration from the main vite.config.ts because
 * ArchUnitTS requires `globals: true` to enable the `toPassAsync()` matcher.
 * Enabling globals project-wide would mask missing imports in application code,
 * so we keep this isolated.
 *
 * Run with: npm run test:arch
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/architecture/**/*.spec.ts'],
    reporters: ['verbose'],
    // archunit's first run builds the entire file dependency graph from scratch.
    // Subsequent tests use the cached graph and run in <10ms each.
    // 30 seconds is generous even for large codebases.
    testTimeout: 30000
  }
});
