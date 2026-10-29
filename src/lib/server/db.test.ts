import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { env, poolOptions, warn } = vi.hoisted(() => ({
  env: {} as Record<string, string>,
  poolOptions: vi.fn(),
  warn: vi.fn()
}));

vi.mock('$env/dynamic/private', () => ({ env }));
vi.mock('./logging', () => ({
  logger: { child: () => ({ warn, debug: vi.fn(), info: vi.fn(), error: vi.fn() }) }
}));
vi.mock('pg', () => ({
  Pool: class {
    constructor(options: unknown) {
      poolOptions(options);
    }
    on = vi.fn();
  }
}));
vi.mock('drizzle-orm/node-postgres', () => ({ drizzle: vi.fn() }));

describe('database environment', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    for (const key of Object.keys(env)) delete env[key];
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('DATABASE_HOST', 'wrong-process-host');
    vi.stubEnv('DATABASE_PASSWORD', 'wrong-process-password');
  });

  afterEach(() => vi.unstubAllEnvs());

  it('uses the database configuration loaded by SvelteKit from .env.development', async () => {
    Object.assign(env, {
      DATABASE_HOST: 'kind-node',
      DATABASE_PORT: '31432',
      DATABASE_NAME: 'dev-db',
      DATABASE_USER: 'dev-user',
      DATABASE_PASSWORD: 'dev-password'
    });

    await import('./db');

    expect(poolOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'kind-node',
        port: 31432,
        database: 'dev-db',
        user: 'dev-user',
        password: 'dev-password',
        ssl: false
      })
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it('validates the SvelteKit password in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');

    await expect(import('./db')).rejects.toThrow('DATABASE_PASSWORD must be set in production');
    expect(poolOptions).not.toHaveBeenCalled();
  });

  describe('TLS', () => {
    let tempDir: string;

    beforeAll(() => {
      tempDir = mkdtempSync(join(tmpdir(), 'db-tls-'));
    });

    afterAll(() => rmSync(tempDir, { recursive: true, force: true }));

    beforeEach(() => {
      vi.stubEnv('NODE_ENV', 'production');
      env.DATABASE_PASSWORD = 'prod-password';
    });

    it('verifies the certificate in production by default', async () => {
      await import('./db');

      expect(poolOptions).toHaveBeenCalledWith(
        expect.objectContaining({ ssl: { rejectUnauthorized: true } })
      );
      expect(warn).not.toHaveBeenCalled();
    });

    it('encrypts without verification in require mode and warns', async () => {
      env.DATABASE_TLS_MODE = 'require';

      await import('./db');

      expect(poolOptions).toHaveBeenCalledWith(
        expect.objectContaining({ ssl: { rejectUnauthorized: false } })
      );
      expect(warn).toHaveBeenCalledWith(
        { tls_mode: 'require' },
        'Database TLS certificate verification is disabled'
      );
    });

    it('accepts a mode with surrounding whitespace', async () => {
      env.DATABASE_TLS_MODE = ' require ';

      await import('./db');

      expect(poolOptions).toHaveBeenCalledWith(
        expect.objectContaining({ ssl: { rejectUnauthorized: false } })
      );
    });

    it('can be disabled in production', async () => {
      env.DATABASE_TLS_MODE = 'disable';

      await import('./db');

      expect(poolOptions).toHaveBeenCalledWith(expect.objectContaining({ ssl: false }));
      expect(warn).toHaveBeenCalledWith({ tls_mode: 'disable' }, 'Database TLS is disabled');
    });

    it('trusts the configured CA certificate', async () => {
      const caCertPath = join(tempDir, 'ca.crt');
      writeFileSync(caCertPath, 'test-ca');
      env.DATABASE_TLS_CA_CERT = caCertPath;

      await import('./db');

      expect(poolOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          ssl: { rejectUnauthorized: true, ca: Buffer.from('test-ca') }
        })
      );
    });

    it('fails when the CA certificate file is missing', async () => {
      env.DATABASE_TLS_CA_CERT = join(tempDir, 'missing.crt');

      await expect(import('./db')).rejects.toThrow('ENOENT');
      expect(poolOptions).not.toHaveBeenCalled();
    });

    it.each(['require', 'disable'])(
      'rejects a CA certificate with mode %s, which would ignore it',
      async (mode) => {
        env.DATABASE_TLS_MODE = mode;
        env.DATABASE_TLS_CA_CERT = join(tempDir, 'ca.crt');

        await expect(import('./db')).rejects.toThrow(
          'DATABASE_TLS_CA_CERT requires DATABASE_TLS_MODE=verify-full'
        );
        expect(poolOptions).not.toHaveBeenCalled();
      }
    );

    it('rejects an unknown mode', async () => {
      env.DATABASE_TLS_MODE = 'prefer';

      await expect(import('./db')).rejects.toThrow('DATABASE_TLS_MODE must be one of');
      expect(poolOptions).not.toHaveBeenCalled();
    });
  });
});
