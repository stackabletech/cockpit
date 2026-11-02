import { describe, it, expect, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: {} }));

import { parseTrinoConfig } from './config.js';

const TRINO_URL = 'https://trino.example.com:8443';

describe('parseTrinoConfig', () => {
  it('uses the defaults when nothing is set', () => {
    expect(parseTrinoConfig({})).toEqual({
      url: undefined,
      publicUrl: undefined,
      authType: 'none',
      authUsername: undefined,
      authPassword: undefined,
      tlsInsecure: false,
      tlsCaCertPath: undefined,
      userImpersonation: true,
      queryTtlSeconds: 1800
    });
  });

  it.each([
    ['STACKABLE_COCKPIT_TRINO_URL', 'trino.example.com:8443'],
    ['STACKABLE_COCKPIT_TRINO_AUTH_TYPE', 'oauth2'],
    ['STACKABLE_COCKPIT_TRINO_TLS_INSECURE', 'yes'],
    ['STACKABLE_COCKPIT_TRINO_USER_IMPERSONATION', 'off'],
    ['STACKABLE_COCKPIT_QUERY_TTL', '30m']
  ])('rejects an invalid %s', (name, value) => {
    expect(() =>
      parseTrinoConfig({ STACKABLE_COCKPIT_TRINO_URL: TRINO_URL, [name]: value })
    ).toThrow(`${name}:`);
  });

  it('requires credentials for basic auth when a Trino URL is set', () => {
    const basic = {
      STACKABLE_COCKPIT_TRINO_AUTH_TYPE: 'basic',
      STACKABLE_COCKPIT_TRINO_AUTH_USERNAME: 'svc'
    };
    expect(() => parseTrinoConfig({ ...basic, STACKABLE_COCKPIT_TRINO_URL: TRINO_URL })).toThrow(
      /STACKABLE_COCKPIT_TRINO_AUTH_PASSWORD is missing/
    );
    expect(parseTrinoConfig(basic).authType).toBe('basic');
  });
});
