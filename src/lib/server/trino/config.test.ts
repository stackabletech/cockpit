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
      userConnectionAllowInsecureTls: false,
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

  it('rejects an invalid STACKABLE_COCKPIT_TRINO_USER_CONNECTION_TLS_ALLOW_INSECURE', () => {
    expect(() =>
      parseTrinoConfig({ STACKABLE_COCKPIT_TRINO_USER_CONNECTION_TLS_ALLOW_INSECURE: 'yes' })
    ).toThrow('STACKABLE_COCKPIT_TRINO_USER_CONNECTION_TLS_ALLOW_INSECURE:');
  });

  it('applies each TLS setting to its own kind of connection', () => {
    expect(
      parseTrinoConfig({
        STACKABLE_COCKPIT_TRINO_URL: TRINO_URL,
        STACKABLE_COCKPIT_TRINO_TLS_INSECURE: 'true'
      })
    ).toMatchObject({ tlsInsecure: true, userConnectionAllowInsecureTls: false });
    expect(
      parseTrinoConfig({ STACKABLE_COCKPIT_TRINO_USER_CONNECTION_TLS_ALLOW_INSECURE: 'true' })
    ).toMatchObject({ tlsInsecure: false, userConnectionAllowInsecureTls: true });
  });

  it('rejects a TLS setting that has no effect', () => {
    expect(() => parseTrinoConfig({ STACKABLE_COCKPIT_TRINO_TLS_INSECURE: 'true' })).toThrow(
      /STACKABLE_COCKPIT_TRINO_TLS_INSECURE: only applies to the pre-configured connection/
    );
    expect(() =>
      parseTrinoConfig({
        STACKABLE_COCKPIT_TRINO_URL: TRINO_URL,
        STACKABLE_COCKPIT_TRINO_USER_CONNECTION_TLS_ALLOW_INSECURE: 'true'
      })
    ).toThrow(/STACKABLE_COCKPIT_TRINO_USER_CONNECTION_TLS_ALLOW_INSECURE: only applies to/);
  });
});
