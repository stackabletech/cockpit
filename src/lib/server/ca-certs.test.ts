import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { setDefaultCACertificates } = vi.hoisted(() => ({ setDefaultCACertificates: vi.fn() }));

vi.mock('node:tls', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:tls')>()),
  setDefaultCACertificates
}));

import { getCACertificates } from 'node:tls';
import { trustCaCerts } from './ca-certs.js';

const testCa = readFileSync(new URL('../test-utils/test-ca.crt', import.meta.url), 'utf8');

describe('trustCaCerts', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'ca-certs-'));
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  beforeEach(() => vi.clearAllMocks());

  function caFile(name: string, content: string) {
    const path = join(dir, name);
    writeFileSync(path, content);
    return path;
  }

  it('leaves the trust store alone when no CA is configured', () => {
    expect(trustCaCerts({})).toEqual([]);
    expect(trustCaCerts({ STACKABLE_COCKPIT_TLS_CA_CERTS: ' ' })).toEqual([]);
    expect(setDefaultCACertificates).not.toHaveBeenCalled();
  });

  it('adds the configured CAs to the default CAs instead of replacing them', () => {
    const path = caFile('ca.crt', testCa);

    expect(trustCaCerts({ STACKABLE_COCKPIT_TLS_CA_CERTS: path })).toEqual([
      { path, certificates: 1 }
    ]);

    const trusted = setDefaultCACertificates.mock.calls[0]![0] as string[];
    const defaults = getCACertificates('default');
    expect(trusted).toHaveLength(defaults.length + 1);
    expect(trusted).toEqual(expect.arrayContaining(defaults));
    expect(trusted.at(-1)!.trim()).toBe(testCa.trim());
  });

  it('reads every certificate of every listed file', () => {
    const bundle = caFile('bundle.crt', `# comment\n${testCa}\n${testCa}`);
    const single = caFile('single.crt', testCa);

    expect(trustCaCerts({ STACKABLE_COCKPIT_TLS_CA_CERTS: `${bundle}, ${single}` })).toEqual([
      { path: bundle, certificates: 2 },
      { path: single, certificates: 1 }
    ]);
    // Duplicates are only trusted once.
    const trusted = setDefaultCACertificates.mock.calls[0]![0] as string[];
    expect(trusted).toHaveLength(getCACertificates('default').length + 1);
  });

  it('fails with the variable name when a file is missing', () => {
    const path = join(dir, 'missing.crt');
    expect(() => trustCaCerts({ STACKABLE_COCKPIT_TLS_CA_CERTS: path })).toThrow(
      `STACKABLE_COCKPIT_TLS_CA_CERTS: cannot read ${path}`
    );
    expect(setDefaultCACertificates).not.toHaveBeenCalled();
  });

  it('fails when a file contains no certificate', () => {
    const path = caFile('empty.crt', 'not a certificate');
    expect(() => trustCaCerts({ STACKABLE_COCKPIT_TLS_CA_CERTS: path })).toThrow(
      `${path} contains no PEM certificate`
    );
  });

  it('fails when a certificate is invalid', () => {
    const path = caFile(
      'broken.crt',
      `${testCa}\n-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----`
    );
    expect(() => trustCaCerts({ STACKABLE_COCKPIT_TLS_CA_CERTS: path })).toThrow(
      `certificate 2 in ${path} is invalid`
    );
    expect(setDefaultCACertificates).not.toHaveBeenCalled();
  });
});
