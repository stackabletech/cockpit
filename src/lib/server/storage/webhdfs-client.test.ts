import { afterEach, describe, it, expect, vi } from 'vitest';

vi.mock('$lib/server/logging', () => ({
  logger: { child: () => ({ debug: vi.fn(), trace: vi.fn(), info: vi.fn(), warn: vi.fn() }) }
}));

import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebHdfsClient, nodeHttpUpload, type Uploader } from './webhdfs-client.js';
import { clearHdfsAuthCookies, kerberosAuth } from './hdfs-auth.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function remoteException(exception: string, message: string, status: number): Response {
  return jsonResponse(
    { RemoteException: { exception, javaClassName: exception, message } },
    status
  );
}

function makeClient(fetchMock: ReturnType<typeof vi.fn>) {
  return new WebHdfsClient({
    baseUrls: ['http://nn:9870/'],
    user: 'alice',
    fetch: fetchMock as unknown as typeof fetch
  });
}

describe('WebHdfsClient.url', () => {
  const client = makeClient(vi.fn());

  it('builds op URLs with user.name and encoded segments', () => {
    const url = new URL(client.url('/data/a b/ü.csv', 'OPEN', { offset: 5, length: undefined }));
    expect(url.origin).toBe('http://nn:9870');
    expect(url.pathname).toBe('/webhdfs/v1/data/a%20b/%C3%BC.csv');
    expect(url.searchParams.get('op')).toBe('OPEN');
    expect(url.searchParams.get('user.name')).toBe('alice');
    expect(url.searchParams.get('offset')).toBe('5');
    expect(url.searchParams.has('length')).toBe(false);
  });

  it('encodes characters that would otherwise change the URL structure', () => {
    const url = new URL(client.url('/x/what?#.txt', 'GETFILESTATUS'));
    expect(url.pathname).toBe('/webhdfs/v1/x/what%3F%23.txt');
  });

  it('handles the root path', () => {
    expect(new URL(client.url('/', 'GETFILESTATUS')).pathname).toBe('/webhdfs/v1/');
  });
});

describe('WebHdfsClient.fromConfig', () => {
  it('defaults the port by scheme', () => {
    const plain = WebHdfsClient.fromConfig({ type: 'hdfs', host: 'nn', user: 'u' });
    const tls = WebHdfsClient.fromConfig({
      type: 'hdfs',
      host: 'nn',
      user: 'u',
      tls: { verification: 'Full' }
    });
    expect(plain.url('/', 'X')).toMatch(/^http:\/\/nn:9870\//);
    expect(tls.url('/', 'X')).toMatch(/^https:\/\/nn:9871\//);
  });
});

describe('WebHdfsClient error mapping', () => {
  it.each([
    ['FileNotFoundException', 404, 404],
    ['AccessControlException', 403, 403],
    ['SecurityException', 403, 403],
    ['FileAlreadyExistsException', 403, 409],
    ['IOException', 500, 502]
  ])('maps %s to HTTP %i', async (exception, status, expected) => {
    const client = makeClient(
      vi.fn().mockResolvedValue(remoteException(exception, 'boom', status))
    );
    await expect(client.getFileStatus('/x')).rejects.toMatchObject({
      status: expected,
      body: { message: 'boom' }
    });
  });

  it('drops the Java stack trace DataNodes append to messages', async () => {
    const message =
      'Permission denied: user=alice, access=WRITE\n\tat org.apache.hadoop.hdfs.Foo(Foo.java:1)';
    const client = makeClient(
      vi.fn().mockResolvedValue(remoteException('AccessControlException', message, 403))
    );
    await expect(client.getFileStatus('/x')).rejects.toMatchObject({
      body: { message: 'Permission denied: user=alice, access=WRITE' }
    });
  });

  it('surfaces the socket error code for network failures', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValue(
        Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } })
      );
    await expect(makeClient(fetchMock).getFileStatus('/')).rejects.toThrow(
      'HDFS GETFILESTATUS request failed: ECONNREFUSED'
    );
  });
});

describe('WebHdfsClient.listStatusBatch', () => {
  it('passes startAfter and returns remaining entries', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        DirectoryListing: {
          partialListing: { FileStatuses: { FileStatus: [{ pathSuffix: 'b' }] } },
          remainingEntries: 3
        }
      })
    );
    const result = await makeClient(fetchMock).listStatusBatch('/d', 'a');
    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get('startAfter')).toBe('a');
    expect(result).toEqual({ statuses: [{ pathSuffix: 'b' }], remainingEntries: 3 });
  });

  it('falls back to LISTSTATUS on servers without LISTSTATUS_BATCH', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        remoteException(
          'IllegalArgumentException',
          'Invalid value for webhdfs parameter "op": No enum constant LISTSTATUS_BATCH',
          400
        )
      )
      .mockResolvedValueOnce(
        jsonResponse({
          FileStatuses: { FileStatus: [{ pathSuffix: 'a' }, { pathSuffix: 'b' }] }
        })
      );
    const result = await makeClient(fetchMock).listStatusBatch('/d', 'a');
    expect(new URL(fetchMock.mock.calls[1][0]).searchParams.get('op')).toBe('LISTSTATUS');
    expect(result).toEqual({ statuses: [{ pathSuffix: 'b' }], remainingEntries: 0 });
  });
});

describe('WebHdfsClient.create', () => {
  function clientWithUpload(fetchMock: ReturnType<typeof vi.fn>, upload: ReturnType<typeof vi.fn>) {
    return new WebHdfsClient({
      baseUrls: ['http://nn:9870'],
      user: 'alice',
      fetch: fetchMock as unknown as typeof fetch,
      upload: upload as unknown as Uploader
    });
  }

  const redirect = (location: string) =>
    vi.fn().mockResolvedValue(new Response(null, { status: 307, headers: { Location: location } }));

  it('asks the NameNode for a location, then uploads the body there', async () => {
    const fetchMock = redirect('http://dn:9864/webhdfs/v1/f?op=CREATE');
    const upload = vi.fn().mockResolvedValue({ status: 201, body: '' });
    const body = new Uint8Array([1, 2, 3]);

    await clientWithUpload(fetchMock, upload).create('/f', body, { overwrite: true });

    const [firstUrl, firstInit] = fetchMock.mock.calls[0];
    expect(new URL(firstUrl).searchParams.get('overwrite')).toBe('true');
    expect(firstInit).toMatchObject({ method: 'PUT', redirect: 'manual' });
    expect(firstInit.body).toBeUndefined();
    expect(upload).toHaveBeenCalledWith('http://dn:9864/webhdfs/v1/f?op=CREATE', body, {
      signal: undefined,
      rejectUnauthorized: true
    });
  });

  it('fails when the NameNode returns no redirect location', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 307 }));
    await expect(
      clientWithUpload(fetchMock, vi.fn()).create('/f', new Uint8Array(), { overwrite: true })
    ).rejects.toThrow('returned no redirect location');
  });

  it('maps a DataNode failure on the upload step', async () => {
    const upload = vi.fn().mockResolvedValue({
      status: 403,
      body: JSON.stringify({
        RemoteException: { exception: 'AccessControlException', message: 'denied' }
      })
    });
    await expect(
      clientWithUpload(redirect('http://dn/'), upload).create('/f', new Uint8Array(), {
        overwrite: true
      })
    ).rejects.toMatchObject({ status: 403, body: { message: 'denied' } });
  });

  it('wraps upload network errors with the socket code', async () => {
    const upload = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('connect refused'), { code: 'ECONNREFUSED' }));
    await expect(
      clientWithUpload(redirect('http://dn/'), upload).create('/f', new Uint8Array(), {
        overwrite: true
      })
    ).rejects.toThrow('HDFS CREATE request failed: ECONNREFUSED');
  });
});

describe('nodeHttpUpload', () => {
  /** Behaves like a DataNode: unsolicited `100 Continue`, then `201 Created`. */
  async function dataNodeLikeServer(): Promise<{
    url: string;
    received: () => string;
    close: () => void;
  }> {
    let received = '';
    const server = createServer((req, res) => {
      res.writeContinue();
      req.on('data', (chunk: Buffer) => (received += chunk.toString()));
      req.on('end', () => {
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end('{"boolean":true}');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    return {
      url: `http://127.0.0.1:${port}/webhdfs/v1/f`,
      received: () => received,
      close: () => server.close()
    };
  }

  it('tolerates an unsolicited 100 Continue and streams the body', async () => {
    const server = await dataNodeLikeServer();
    try {
      const result = await nodeHttpUpload(server.url, new Response('streamed body').body!, {
        rejectUnauthorized: true
      });
      expect(result).toEqual({ status: 201, body: '{"boolean":true}' });
      expect(server.received()).toBe('streamed body');
    } finally {
      server.close();
    }
  });

  it('sends buffers with a Content-Length', async () => {
    const server = await dataNodeLikeServer();
    try {
      await nodeHttpUpload(server.url, new TextEncoder().encode('buffer'), {
        rejectUnauthorized: true
      });
      expect(server.received()).toBe('buffer');
    } finally {
      server.close();
    }
  });
});

describe('WebHdfsClient.open', () => {
  it('requests a byte range and follows the DataNode redirect itself', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 307,
          headers: { Location: 'http://dn:9864/webhdfs/v1/f?op=OPEN' }
        })
      )
      .mockResolvedValueOnce(new Response('hello'));
    const stream = await makeClient(fetchMock).open('/f', { offset: 10, length: 5 });
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.searchParams.get('offset')).toBe('10');
    expect(url.searchParams.get('length')).toBe('5');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: 'manual' });
    expect(fetchMock.mock.calls[1][0]).toBe('http://dn:9864/webhdfs/v1/f?op=OPEN');
    expect(await new Response(stream).text()).toBe('hello');
  });

  it('reads directly when the server answers without a redirect (HttpFS)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('direct'));
    const stream = await makeClient(fetchMock).open('/f');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await new Response(stream).text()).toBe('direct');
  });

  it('maps a DataNode error on the redirected read', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, { status: 307, headers: { Location: 'http://dn/' } })
      )
      .mockResolvedValueOnce(remoteException('FileNotFoundException', 'gone', 404));
    await expect(makeClient(fetchMock).open('/f')).rejects.toMatchObject({ status: 404 });
  });
});

describe('WebHdfsClient NameNode failover', () => {
  let cluster = 0;
  /** Unique NameNode hostnames per test: the active NameNode is remembered per set. */
  function haClient(fetchMock: ReturnType<typeof vi.fn>) {
    cluster++;
    const baseUrls = [`http://nn0-${cluster}:9870`, `http://nn1-${cluster}:9870`];
    const client = new WebHdfsClient({
      baseUrls,
      user: 'alice',
      fetch: fetchMock as unknown as typeof fetch
    });
    return { client, baseUrls };
  }
  const standby = () =>
    remoteException(
      'StandbyException',
      'Operation category READ is not supported in state standby',
      403
    );
  const status = () => jsonResponse({ FileStatus: { pathSuffix: '', type: 'DIRECTORY' } });
  const connectRefused = () =>
    Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
  const hostOf = (call: unknown[]) => new URL(call[0] as string).host;

  it('moves on from a standby NameNode and remembers the active one', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(standby())
      .mockResolvedValueOnce(status())
      .mockResolvedValueOnce(status());
    const { client, baseUrls } = haClient(fetchMock);

    await client.getFileStatus('/');
    expect(fetchMock.mock.calls.map(hostOf)).toEqual([
      new URL(baseUrls[0]).host,
      new URL(baseUrls[1]).host
    ]);

    // A new client for the same NameNodes (as for the next request) starts with the active one.
    const next = new WebHdfsClient({
      baseUrls,
      user: 'alice',
      fetch: fetchMock as unknown as typeof fetch
    });
    await next.getFileStatus('/');
    expect(hostOf(fetchMock.mock.calls[2])).toBe(new URL(baseUrls[1]).host);
  });

  it('fails back when the remembered NameNode becomes standby', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(standby())
      .mockResolvedValueOnce(status())
      .mockResolvedValueOnce(standby())
      .mockResolvedValueOnce(status());
    const { client, baseUrls } = haClient(fetchMock);
    await client.getFileStatus('/');
    await client.getFileStatus('/');
    expect(fetchMock.mock.calls.map(hostOf)).toEqual(
      [0, 1, 1, 0].map((i) => new URL(baseUrls.at(i)!).host)
    );
  });

  it('moves on when a NameNode refuses connections', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(connectRefused())
      .mockResolvedValueOnce(status());
    const { client } = haClient(fetchMock);
    await expect(client.getFileStatus('/')).resolves.toMatchObject({ type: 'DIRECTORY' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry a write after a connection reset (it may have executed)', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValue(
        Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } })
      );
    const { client } = haClient(fetchMock);
    await expect(client.rename('/a', '/b')).rejects.toThrow(
      'HDFS RENAME request failed: ECONNRESET'
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not fail over on ordinary HDFS errors', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(remoteException('AccessControlException', 'denied', 403));
    const { client } = haClient(fetchMock);
    await expect(client.getFileStatus('/x')).rejects.toMatchObject({ status: 403 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports 502 when no NameNode is active', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => standby());
    const { client, baseUrls } = haClient(fetchMock);
    await expect(client.getFileStatus('/')).rejects.toMatchObject({
      status: 502,
      body: { message: `No active HDFS NameNode among ${baseUrls.join(', ')}` }
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('only sends the CREATE step to the NameNodes, never the DataNode upload', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(standby())
      .mockResolvedValueOnce(
        new Response(null, { status: 307, headers: { Location: 'http://dn/' } })
      );
    const upload = vi.fn().mockResolvedValue({ status: 201, body: '' });
    cluster++;
    const client = new WebHdfsClient({
      baseUrls: [`http://nn0-${cluster}:9870`, `http://nn1-${cluster}:9870`],
      user: 'alice',
      fetch: fetchMock as unknown as typeof fetch,
      upload: upload as unknown as Uploader
    });
    await client.create('/f', new Uint8Array([1]), { overwrite: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload.mock.calls[0][0]).toBe('http://dn/');
  });

  it('builds base URLs from the NameNode list with a default port', () => {
    const client = WebHdfsClient.fromConfig({
      type: 'hdfs',
      host: 'nn0',
      nameNodes: ['nn0', 'nn1:9999'],
      user: 'u'
    });
    expect(client.url('/', 'X')).toMatch(/^http:\/\/nn0:9870\//);
  });
});

describe('WebHdfsClient authentication', () => {
  // Unique hostnames per test: auth cookies and the active NameNode are cached per host.
  let hostCounter = 0;
  const uniqueHost = (prefix: string) => `${prefix}-${++hostCounter}.example`;
  function kerberosClient(
    fetchMock: ReturnType<typeof vi.fn>,
    step = vi.fn().mockResolvedValue('tok')
  ) {
    const initializeClient = vi.fn().mockResolvedValue({ step });
    const client = new WebHdfsClient({
      baseUrls: [`https://${uniqueHost('nn-kerberos')}:9871`],
      auth: kerberosAuth({
        servicePrincipal: 'HTTP/hdfs.default.svc.cluster.local@CLUSTER.LOCAL',
        proxyUser: 'alice',
        loadKerberos: async () => ({ initializeClient })
      }),
      fetch: fetchMock as unknown as typeof fetch
    });
    return { client, initializeClient, step };
  }
  const status = (headers: Record<string, string> = {}) =>
    new Response(JSON.stringify({ FileStatus: { pathSuffix: '', type: 'DIRECTORY' } }), {
      headers: { 'Content-Type': 'application/json', ...headers }
    });

  afterEach(() => clearHdfsAuthCookies());

  it('sends doas and a SPNEGO token for the configured service principal', async () => {
    const fetchMock = vi.fn().mockResolvedValue(status());
    const { client, initializeClient } = kerberosClient(fetchMock);
    await client.getFileStatus('/');

    const [url, init] = fetchMock.mock.calls[0];
    const params = new URL(url).searchParams;
    expect(params.get('doas')).toBe('alice');
    expect(params.has('user.name')).toBe(false);
    expect(init.headers).toMatchObject({ Authorization: 'Negotiate tok' });
    expect(initializeClient).toHaveBeenCalledWith('HTTP@hdfs.default.svc.cluster.local', {});
  });

  it('reuses the hadoop.auth cookie instead of negotiating again', async () => {
    const expiry = Date.now() + 3_600_000;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        status({ 'Set-Cookie': `hadoop.auth="u=cockpit&t=kerberos&e=${expiry}&s=sig"; Path=/` })
      )
      .mockResolvedValueOnce(status());
    const { client, step } = kerberosClient(fetchMock);
    await client.getFileStatus('/');
    await client.getFileStatus('/');

    expect(step).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[1][1].headers).toMatchObject({
      Cookie: `hadoop.auth="u=cockpit&t=kerberos&e=${expiry}&s=sig"`
    });
  });

  it('negotiates again once after a 401 and then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('expired', { status: 401 }))
      .mockResolvedValueOnce(status());
    const { client, step } = kerberosClient(fetchMock);
    await expect(client.getFileStatus('/')).resolves.toMatchObject({ type: 'DIRECTORY' });
    expect(step).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reports a persistent 401 as rejected Kerberos credentials', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response('no', { status: 401 }));
    const { client } = kerberosClient(fetchMock);
    await expect(client.getFileStatus('/')).rejects.toMatchObject({
      status: 403,
      body: { message: expect.stringContaining('Kerberos credentials') }
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('tells simple-auth users that the cluster needs Kerberos', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('auth required', { status: 401 }));
    await expect(makeClient(fetchMock).getFileStatus('/')).rejects.toMatchObject({
      status: 403,
      body: { message: expect.stringContaining('Connect with Kerberos') }
    });
  });

  it('reports GSSAPI failures as 502 without contacting HDFS', async () => {
    const fetchMock = vi.fn();
    const { client } = kerberosClient(
      fetchMock,
      vi.fn().mockRejectedValue(new Error('Server not found in Kerberos database'))
    );
    await expect(client.getFileStatus('/')).rejects.toMatchObject({
      status: 502,
      body: { message: expect.stringContaining('Server not found in Kerberos database') }
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails over between NameNodes with Kerberos too', async () => {
    const standby = new Response(
      JSON.stringify({ RemoteException: { exception: 'StandbyException', message: 'standby' } }),
      { status: 403 }
    );
    const fetchMock = vi.fn().mockResolvedValueOnce(standby).mockResolvedValueOnce(status());
    const initializeClient = vi.fn().mockResolvedValue({ step: vi.fn().mockResolvedValue('tok') });
    const client = new WebHdfsClient({
      baseUrls: [`https://${uniqueHost('a')}:9871`, `https://${uniqueHost('b')}:9871`],
      auth: kerberosAuth({
        servicePrincipal: 'HTTP/hdfs.default.svc.cluster.local',
        proxyUser: 'alice',
        loadKerberos: async () => ({ initializeClient })
      }),
      fetch: fetchMock as unknown as typeof fetch
    });
    await expect(client.getFileStatus('/')).resolves.toMatchObject({ type: 'DIRECTORY' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('WebHdfsClient.fromConfig security settings', () => {
  const base = { type: 'hdfs' as const, host: 'nn-0.example', user: 'alice' };

  it('refuses Kerberos connections when the server has no keytab', () => {
    expect(() =>
      WebHdfsClient.fromConfig({ ...base, auth: 'kerberos' }, undefined, {
        kerberosAvailable: false
      })
    ).toThrow(expect.objectContaining({ status: 400 }));
  });

  it('uses doas with Kerberos and user.name otherwise', () => {
    const kerberos = WebHdfsClient.fromConfig(
      { ...base, auth: 'kerberos', tls: { verification: 'Full' } },
      undefined,
      { kerberosAvailable: true }
    );
    expect(new URL(kerberos.url('/', 'X')).searchParams.get('doas')).toBe('alice');
    expect(kerberos.url('/', 'X')).toMatch(/^https:\/\/nn-0\.example:9871\//);
    const simple = WebHdfsClient.fromConfig(base, undefined, { kerberosAvailable: true });
    expect(new URL(simple.url('/', 'X')).searchParams.get('user.name')).toBe('alice');
  });

  it('passes the server CA bundle to DataNode uploads', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hdfs-ca-'));
    const caPath = join(dir, 'ca.crt');
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- temp file created by this test
    writeFileSync(caPath, '-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----\n');
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 307, headers: { Location: 'https://dn/' } }));
    const client = WebHdfsClient.fromConfig(
      { ...base, tls: { verification: 'Full' } },
      fetchMock as unknown as typeof fetch,
      { kerberosAvailable: false, caCertPath: caPath }
    );
    const upload = vi.fn().mockResolvedValue({ status: 201, body: '' });
    (client as unknown as { upload: typeof upload }).upload = upload;
    await client.create('/f', new Uint8Array([1]), { overwrite: true });
    expect(upload.mock.calls[0][2]).toMatchObject({
      rejectUnauthorized: true,
      ca: expect.stringContaining('TEST')
    });
  });
});

describe('WebHdfsClient trash operations', () => {
  it('reads the trash interval from GETSERVERDEFAULTS', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ FsServerDefaults: { replication: 3, trashInterval: 1440 } })
      );
    expect(await makeClient(fetchMock).getServerDefaults()).toEqual({ trashInterval: 1440 });
    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get('op')).toBe('GETSERVERDEFAULTS');
  });

  it('reads the trash root for a path', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ Path: '/user/alice/.Trash' }));
    expect(await makeClient(fetchMock).getTrashRoot('/data/x')).toBe('/user/alice/.Trash');
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.pathname).toBe('/webhdfs/v1/data/x');
    expect(url.searchParams.get('op')).toBe('GETTRASHROOT');
  });
});

describe('WebHdfsClient boolean operations', () => {
  it('passes the rename destination and returns the result', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ boolean: false }));
    expect(await makeClient(fetchMock).rename('/a', '/b c')).toBe(false);
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.searchParams.get('op')).toBe('RENAME');
    expect(url.searchParams.get('destination')).toBe('/b c');
  });

  it('throws when MKDIRS returns false', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ boolean: false }));
    await expect(makeClient(fetchMock).mkdirs('/d')).rejects.toThrow('MKDIRS failed');
  });

  it('sends recursive DELETE', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ boolean: true }));
    expect(await makeClient(fetchMock).delete('/d', true)).toBe(true);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'DELETE' });
    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get('recursive')).toBe('true');
  });
});
