import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { env, poolOptions, warn } = vi.hoisted(() => ({
  env: {} as Record<string, string>,
  poolOptions: vi.fn(),
  warn: vi.fn()
}));

vi.mock('$env/dynamic/private', () => ({ env }));
vi.mock('./logging', () => ({
  logger: { child: () => ({ warn, info: vi.fn(), error: vi.fn() }) }
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
});
