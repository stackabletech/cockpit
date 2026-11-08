import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { env, poolOptions, warn, info, trustCaCerts } = vi.hoisted(() => ({
  env: {} as Record<string, string>,
  poolOptions: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  trustCaCerts: vi.fn(() => [] as { path: string; certificates: number }[])
}));

vi.mock('$env/dynamic/private', () => ({ env }));
vi.mock('./logging', () => ({
  logger: { child: () => ({ warn, debug: vi.fn(), info, error: vi.fn() }) }
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
vi.mock('./ca-certs', () => ({ trustCaCerts }));

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

    it('trusts the configured CA certificates before connecting', async () => {
      env.STACKABLE_COCKPIT_TLS_CA_CERTS = '/etc/ca/a.crt';
      trustCaCerts.mockReturnValue([{ path: '/etc/ca/a.crt', certificates: 1 }]);

      await import('./db');

      expect(trustCaCerts).toHaveBeenCalledWith(env);
      expect(trustCaCerts.mock.invocationCallOrder[0]).toBeLessThan(
        poolOptions.mock.invocationCallOrder[0]!
      );
      expect(info).toHaveBeenCalledWith(
        { ca_files: [{ path: '/etc/ca/a.crt', certificates: 1 }] },
        'Trusting additional CA certificates'
      );
    });

    it('rejects an unknown mode', async () => {
      env.DATABASE_TLS_MODE = 'prefer';

      await expect(import('./db')).rejects.toThrow('DATABASE_TLS_MODE must be one of');
      expect(poolOptions).not.toHaveBeenCalled();
    });
  });
});
