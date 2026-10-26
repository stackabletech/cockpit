import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('$lib/server/logging', () => ({
  logger: { child: () => ({ debug: vi.fn(), trace: vi.fn(), info: vi.fn(), warn: vi.fn() }) }
}));

import { clearHdfsAuthCookies, gssServiceName, kerberosAuth, simpleAuth } from './hdfs-auth.js';

afterEach(() => clearHdfsAuthCookies());

function fakeKerberos(token = 'tok') {
  const step = vi.fn().mockResolvedValue(token);
  const initializeClient = vi.fn().mockResolvedValue({ step });
  return { loadKerberos: async () => ({ initializeClient }), initializeClient, step };
}

describe('gssServiceName', () => {
  it.each([
    ['HTTP/hdfs.default.svc.cluster.local@CLUSTER.LOCAL', 'HTTP@hdfs.default.svc.cluster.local'],
    ['HTTP/hdfs.default.svc.cluster.local', 'HTTP@hdfs.default.svc.cluster.local'],
    ['HTTP@nn-0.example', 'HTTP@nn-0.example']
  ])('converts %s to %s', (principal, expected) => {
    expect(gssServiceName(principal)).toBe(expected);
  });

  it('rejects principals without a host', () => {
    expect(() => gssServiceName('HTTP')).toThrow(expect.objectContaining({ status: 400 }));
  });
});

describe('simpleAuth', () => {
  it('identifies the user with user.name and no headers', async () => {
    const auth = simpleAuth('alice');
    expect(auth.params).toEqual({ 'user.name': 'alice' });
    expect(await auth.headers('http://nn')).toEqual({});
    expect(auth.onResponse('http://nn', new Response(null, { status: 401 }), false)).toBe(false);
  });
});

describe('kerberosAuth', () => {
  it('passes an explicit client principal to GSSAPI', async () => {
    const kerberos = fakeKerberos();
    const auth = kerberosAuth({
      servicePrincipal: 'HTTP/hdfs.example',
      proxyUser: 'alice',
      principal: 'cockpit/cockpit.default.svc.cluster.local@CLUSTER.LOCAL',
      loadKerberos: kerberos.loadKerberos
    });
    expect(await auth.headers('https://nn')).toEqual({ Authorization: 'Negotiate tok' });
    expect(kerberos.initializeClient).toHaveBeenCalledWith('HTTP@hdfs.example', {
      principal: 'cockpit/cockpit.default.svc.cluster.local@CLUSTER.LOCAL'
    });
  });

  it('negotiates again once the hadoop.auth cookie has expired', async () => {
    const kerberos = fakeKerberos();
    const auth = kerberosAuth({
      servicePrincipal: 'HTTP/hdfs.example',
      proxyUser: 'alice',
      loadKerberos: kerberos.loadKerberos
    });
    const expired = Date.now() + 30_000; // within the one-minute renewal margin
    auth.onResponse(
      'https://nn',
      new Response(null, { headers: { 'Set-Cookie': `hadoop.auth="u=c&e=${expired}&s=x"` } }),
      false
    );
    expect(await auth.headers('https://nn')).toEqual({ Authorization: 'Negotiate tok' });
  });

  it('keeps cookies per NameNode', async () => {
    const kerberos = fakeKerberos();
    const auth = kerberosAuth({
      servicePrincipal: 'HTTP/hdfs.example',
      proxyUser: 'alice',
      loadKerberos: kerberos.loadKerberos
    });
    const valid = Date.now() + 3_600_000;
    auth.onResponse(
      'https://nn-0',
      new Response(null, { headers: { 'Set-Cookie': `hadoop.auth="u=c&e=${valid}&s=x"` } }),
      false
    );
    expect(await auth.headers('https://nn-0')).toHaveProperty('Cookie');
    expect(await auth.headers('https://nn-1')).toHaveProperty('Authorization');
  });

  it('asks for one retry on 401 and drops the cookie', async () => {
    const kerberos = fakeKerberos();
    const auth = kerberosAuth({
      servicePrincipal: 'HTTP/hdfs.example',
      proxyUser: 'alice',
      loadKerberos: kerberos.loadKerberos
    });
    const valid = Date.now() + 3_600_000;
    auth.onResponse(
      'https://nn',
      new Response(null, { headers: { 'Set-Cookie': `hadoop.auth="u=c&e=${valid}&s=x"` } }),
      false
    );
    expect(auth.onResponse('https://nn', new Response(null, { status: 401 }), false)).toBe(true);
    expect(auth.onResponse('https://nn', new Response(null, { status: 401 }), true)).toBe(false);
    expect(await auth.headers('https://nn')).toHaveProperty('Authorization');
  });
});
