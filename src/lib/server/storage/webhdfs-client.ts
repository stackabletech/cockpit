import { readFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { Readable } from 'node:stream';
import { error, isHttpError } from '@sveltejs/kit';
import { Agent } from 'undici';
import { logger } from '$lib/server/logging';
import { hdfsHttpError, parseRemoteException } from './hdfs-errors.js';
import { kerberosAuth, simpleAuth, type HdfsAuthenticator } from './hdfs-auth.js';
import type { HDFSConnectionConfig } from './types.js';
import {
  hdfsKerberosAvailable,
  hdfsKerberosPrincipal,
  hdfsTlsCaCertPath
} from '$lib/server/feature-flags.js';

const log = logger.child({ module: 'webhdfs-client' });

/** A WebHDFS `FileStatus` (only the fields cockpit reads). */
export interface HdfsFileStatus {
  pathSuffix: string;
  type: 'FILE' | 'DIRECTORY' | 'SYMLINK';
  length: number;
  modificationTime: number;
  owner: string;
  group: string;
  permission: string;
  replication: number;
  blockSize: number;
}

export interface HdfsContentSummary {
  directoryCount: number;
  fileCount: number;
  length: number;
  quota: number;
  spaceConsumed: number;
  spaceQuota: number;
}

export interface HdfsAclStatus {
  owner: string;
  group: string;
  permission: string;
  entries: string[];
}

/** Streams a request body to a URL with PUT and returns the final response. */
export type Uploader = (
  url: string,
  body: ReadableStream<Uint8Array> | Uint8Array,
  options: { signal?: AbortSignal; rejectUnauthorized: boolean; ca?: string }
) => Promise<{ status: number; body: string }>;

/**
 * PUT a body with Node's `http` module. DataNodes answer WebHDFS CREATE with
 * an unsolicited `100 Continue` before `201 Created`, which undici's fetch
 * rejects as a bad response; Node's HTTP client treats it as informational.
 */
export const nodeHttpUpload: Uploader = (url, body, { signal, rejectUnauthorized, ca }) =>
  new Promise((resolve, reject) => {
    const target = new URL(url);
    const headers = {
      'Content-Type': 'application/octet-stream',
      ...(body instanceof Uint8Array ? { 'Content-Length': String(body.byteLength) } : {})
    };
    const onResponse = (res: import('node:http').IncomingMessage) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () =>
        resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') })
      );
      res.on('error', reject);
    };
    const request =
      target.protocol === 'https:'
        ? httpsRequest(
            target,
            { method: 'PUT', headers, signal, rejectUnauthorized, ...(ca ? { ca } : {}) },
            onResponse
          )
        : httpRequest(target, { method: 'PUT', headers, signal }, onResponse);
    request.on('error', reject);
    if (body instanceof Uint8Array) {
      request.end(body);
    } else {
      Readable.fromWeb(body as import('node:stream/web').ReadableStream<Uint8Array>)
        .on('error', (err) => request.destroy(err))
        .pipe(request);
    }
  });

export interface WebHdfsClientOptions {
  /**
   * NameNode WebHDFS (or HttpFS) base URLs, e.g. `http://namenode-0:9870`.
   * List every NameNode of an HA cluster; requests go to the active one.
   */
  baseUrls: string[];
  /** Simple-auth user; ignored when `auth` is given. */
  user?: string;
  auth?: HdfsAuthenticator;
  dispatcher?: Agent;
  /** Skip TLS certificate verification (also applied to DataNode uploads). */
  insecureTls?: boolean;
  /** PEM CA bundle for DataNode uploads (NameNode requests use `dispatcher`). */
  ca?: string;
  fetch?: typeof fetch;
  upload?: Uploader;
}

type Params = Record<string, string | number | boolean | undefined>;

/**
 * Index of the NameNode last seen active, keyed by the NameNode set. Providers
 * are created per request, so this lets them start with the active NameNode
 * instead of rediscovering it through a standby on every request.
 */
const activeNameNodes = new Map<string, number>();

/** Server-wide HDFS settings, from feature-flags.ts. */
export interface HdfsServerSettings {
  caCertPath?: string;
  kerberosAvailable: boolean;
  kerberosPrincipal?: string;
}

const serverSettings: HdfsServerSettings = {
  caCertPath: hdfsTlsCaCertPath,
  kerberosAvailable: hdfsKerberosAvailable,
  kerberosPrincipal: hdfsKerberosPrincipal
};

const caCache = new Map<string, string>();
function readCa(path: string): string {
  let ca = caCache.get(path);
  if (ca === undefined) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path comes from server configuration
    ca = readFileSync(path, 'utf8');
    caCache.set(path, ca);
  }
  return ca;
}

/** One undici Agent per TLS setting, shared by the per-request clients. */
const agents = new Map<string, Agent>();
function tlsAgent(ca: string | undefined, insecure: boolean): Agent | undefined {
  if (!ca && !insecure) return undefined;
  const key = `${insecure}|${ca ?? ''}`;
  let agent = agents.get(key);
  if (!agent) {
    agent = new Agent({ connect: { rejectUnauthorized: !insecure, ...(ca ? { ca } : {}) } });
    agents.set(key, agent);
  }
  return agent;
}

/** Socket errors raised before a request reached the server, so retrying elsewhere is safe. */
const CONNECT_FAILURE_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'UND_ERR_CONNECT_TIMEOUT'
]);

function isConnectFailure(err: unknown): boolean {
  const cause = (err as { cause?: { code?: string } }).cause;
  return CONNECT_FAILURE_CODES.has(cause?.code ?? '');
}

/** Wrap a network failure, surfacing the socket error code (ECONNREFUSED, …). */
function requestFailed(err: unknown, op: string): Error {
  if (err instanceof Error && err.name === 'AbortError') return err;
  const cause = (err as { cause?: { code?: string; message?: string } }).cause;
  const code = (err as { code?: string }).code;
  const reason = cause?.code ?? cause?.message ?? code ?? (err as Error).message;
  return new Error(`HDFS ${op} request failed: ${reason}`, { cause: err });
}

/**
 * Minimal WebHDFS REST client. Works against NameNode WebHDFS (which
 * redirects data operations to DataNodes) and HttpFS (which does not).
 * Authenticates with simple auth (`user.name`) or Kerberos (SPNEGO + `doas`).
 * DataNode hops need no authentication of their own: the NameNode's redirect
 * carries `user.name` or a delegation token.
 */
export class WebHdfsClient {
  private readonly baseUrls: string[];
  private readonly haKey: string;
  private readonly auth: HdfsAuthenticator;
  private readonly dispatcher?: Agent;
  private readonly insecureTls: boolean;
  private readonly ca?: string;
  private readonly fetchFn: typeof fetch;
  private readonly upload: Uploader;

  constructor(options: WebHdfsClientOptions) {
    if (options.baseUrls.length === 0) throw new Error('At least one NameNode URL is required');
    this.baseUrls = options.baseUrls.map((url) => url.replace(/\/+$/, ''));
    this.haKey = this.baseUrls.join(',');
    if (!options.auth && !options.user) throw new Error('A user or authenticator is required');
    this.auth = options.auth ?? simpleAuth(options.user!);
    this.dispatcher = options.dispatcher;
    this.insecureTls = options.insecureTls ?? false;
    this.ca = options.ca;
    this.fetchFn = options.fetch ?? fetch;
    this.upload = options.upload ?? nodeHttpUpload;
  }

  static fromConfig(
    config: HDFSConnectionConfig,
    fetchFn?: typeof fetch,
    settings: HdfsServerSettings = serverSettings
  ): WebHdfsClient {
    const tls = !!config.tls;
    const defaultPort = config.port ?? (tls ? 9871 : 9870);
    const insecureTls = config.tls?.verification === 'None';
    const ca = tls && settings.caCertPath ? readCa(settings.caCertPath) : undefined;
    const nameNodes = config.nameNodes?.length ? config.nameNodes : [config.host];

    let auth: HdfsAuthenticator;
    if (config.auth === 'kerberos') {
      if (!settings.kerberosAvailable) {
        throw error(400, 'Kerberos is not configured on this cockpit server (no keytab)');
      }
      auth = kerberosAuth({
        servicePrincipal: config.servicePrincipal || `HTTP/${config.host}`,
        proxyUser: config.user,
        principal: settings.kerberosPrincipal
      });
    } else {
      auth = simpleAuth(config.user);
    }

    return new WebHdfsClient({
      baseUrls: nameNodes.map((nameNode) => {
        const hasPort = /:\d+$/.test(nameNode);
        return `${tls ? 'https' : 'http'}://${nameNode}${hasPort ? '' : `:${defaultPort}`}`;
      }),
      auth,
      dispatcher: tlsAgent(ca, insecureTls),
      insecureTls,
      ca,
      fetch: fetchFn
    });
  }

  private get activeIndex(): number {
    return activeNameNodes.get(this.haKey) ?? 0;
  }

  /** URL for an operation on the active NameNode (or on `baseUrl`). */
  url(path: string, op: string, params: Params = {}, baseUrl?: string): string {
    const encoded = path
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/');
    const query = new URLSearchParams({ op, ...this.auth.params });
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) query.set(key, String(value));
    }
    const base = baseUrl ?? this.baseUrls.at(this.activeIndex) ?? this.baseUrls[0];
    return `${base}/webhdfs/v1${encoded.startsWith('/') ? '' : '/'}${encoded}?${query}`;
  }

  /** NameNode request with authentication headers; retried once when the authenticator asks. */
  private async fetchAuthenticated(
    url: string,
    baseUrl: string,
    init: RequestInit
  ): Promise<Response> {
    for (let retried = false; ; retried = true) {
      const headers = {
        ...(init.headers as Record<string, string>),
        ...(await this.auth.headers(baseUrl))
      };
      const response = await this.fetchWithDispatcher(url, { ...init, headers });
      if (!this.auth.onResponse(baseUrl, response, retried)) return response;
      await response.body?.cancel();
    }
  }

  private fetchWithDispatcher(url: string, init: RequestInit): Promise<Response> {
    return this.fetchFn(url, {
      ...init,
      // @ts-expect-error — Node fetch supports dispatcher via undici
      dispatcher: this.dispatcher
    });
  }

  /**
   * Send an operation to the NameNodes, starting with the one last seen
   * active. Moves on to the next NameNode only when the request provably did
   * not execute: the NameNode answered StandbyException, or no connection
   * could be established. Remembers the NameNode that answered.
   */
  private async send(
    path: string,
    op: string,
    params: Params,
    init: RequestInit
  ): Promise<Response> {
    const context = { op, path };
    const start = this.activeIndex;
    const count = this.baseUrls.length;

    for (let attempt = 0; attempt < count; attempt++) {
      const index = (start + attempt) % count;
      const baseUrl = this.baseUrls.at(index) ?? this.baseUrls[0];
      const canFailOver = attempt < count - 1;

      let response: Response;
      try {
        response = await this.fetchAuthenticated(
          this.url(path, op, params, baseUrl),
          baseUrl,
          init
        );
      } catch (err) {
        if (isHttpError(err)) throw err;
        if (canFailOver && isConnectFailure(err)) {
          log.warn(
            { op, namenode: baseUrl, err: (err as Error).message },
            'HDFS NameNode unreachable, trying next'
          );
          continue;
        }
        throw requestFailed(err, op);
      }

      if (!response.ok && !(response.status >= 300 && response.status < 400)) {
        const body = await response.text();
        if (response.status === 401) {
          throw error(
            403,
            this.auth.kind === 'kerberos'
              ? "HDFS rejected cockpit's Kerberos credentials (HTTP 401). Check the service principal and keytab."
              : 'HDFS requires authentication (HTTP 401). Connect with Kerberos.'
          );
        }
        if (count > 1 && parseRemoteException(body).exception === 'StandbyException') {
          log.debug({ op, namenode: baseUrl }, 'HDFS NameNode is standby, trying next');
          continue;
        }
        hdfsHttpError(response.status, body, context);
      }

      if (index !== start) {
        activeNameNodes.set(this.haKey, index);
        log.info({ op, namenode: baseUrl }, 'Switched to active HDFS NameNode');
      }
      return response;
    }

    throw error(502, `No active HDFS NameNode among ${this.baseUrls.join(', ')}`);
  }

  private async json<T>(
    method: string,
    path: string,
    op: string,
    params?: Params,
    signal?: AbortSignal
  ): Promise<T> {
    log.debug({ op, path }, 'WebHDFS request');
    const response = await this.send(path, op, params ?? {}, { method, signal });
    return (await response.json()) as T;
  }

  async getFileStatus(path: string, signal?: AbortSignal): Promise<HdfsFileStatus> {
    const body = await this.json<{ FileStatus: HdfsFileStatus }>(
      'GET',
      path,
      'GETFILESTATUS',
      {},
      signal
    );
    return body.FileStatus;
  }

  /**
   * One batch of a directory listing, in name order, starting after `startAfter`.
   * Falls back to a full `LISTSTATUS` on servers without `LISTSTATUS_BATCH`.
   */
  async listStatusBatch(
    path: string,
    startAfter?: string,
    signal?: AbortSignal
  ): Promise<{ statuses: HdfsFileStatus[]; remainingEntries: number }> {
    try {
      const body = await this.json<{
        DirectoryListing: {
          partialListing: { FileStatuses: { FileStatus: HdfsFileStatus[] } };
          remainingEntries: number;
        };
      }>('GET', path, 'LISTSTATUS_BATCH', { startAfter }, signal);
      return {
        statuses: body.DirectoryListing.partialListing.FileStatuses.FileStatus ?? [],
        remainingEntries: body.DirectoryListing.remainingEntries
      };
    } catch (err) {
      const message = isHttpError(err) ? err.body.message : '';
      if (!/LISTSTATUS_BATCH|Invalid value for webhdfs/i.test(message)) throw err;
      log.debug({ path }, 'LISTSTATUS_BATCH unsupported, falling back to LISTSTATUS');
      const all = await this.listStatus(path, signal);
      const statuses = startAfter ? all.filter((s) => s.pathSuffix > startAfter) : all;
      return { statuses, remainingEntries: 0 };
    }
  }

  async listStatus(path: string, signal?: AbortSignal): Promise<HdfsFileStatus[]> {
    const body = await this.json<{ FileStatuses: { FileStatus: HdfsFileStatus[] } }>(
      'GET',
      path,
      'LISTSTATUS',
      {},
      signal
    );
    return body.FileStatuses.FileStatus ?? [];
  }

  async getContentSummary(path: string): Promise<HdfsContentSummary> {
    const body = await this.json<{ ContentSummary: HdfsContentSummary }>(
      'GET',
      path,
      'GETCONTENTSUMMARY'
    );
    return body.ContentSummary;
  }

  /** NameNode defaults; `trashInterval` is `fs.trash.interval` in minutes (0 = trash disabled). */
  async getServerDefaults(): Promise<{ trashInterval: number }> {
    const body = await this.json<{ FsServerDefaults: { trashInterval?: number } }>(
      'GET',
      '/',
      'GETSERVERDEFAULTS'
    );
    return { trashInterval: body.FsServerDefaults.trashInterval ?? 0 };
  }

  /** The user's trash directory for a path (differs inside encryption zones). */
  async getTrashRoot(path: string): Promise<string> {
    const body = await this.json<{ Path: string }>('GET', path, 'GETTRASHROOT');
    return body.Path;
  }

  async getAclStatus(path: string): Promise<HdfsAclStatus> {
    const body = await this.json<{ AclStatus: HdfsAclStatus }>('GET', path, 'GETACLSTATUS');
    return body.AclStatus;
  }

  /**
   * Read a file, optionally a byte range. The DataNode redirect is followed
   * manually so that only the NameNode request takes part in failover.
   */
  async open(
    path: string,
    range?: { offset: number; length: number },
    signal?: AbortSignal
  ): Promise<ReadableStream<Uint8Array>> {
    log.debug({ op: 'OPEN', path, offset: range?.offset, length: range?.length }, 'WebHDFS read');
    let response = await this.send(
      path,
      'OPEN',
      range ? { offset: range.offset, length: range.length } : {},
      { method: 'GET', redirect: 'manual', signal }
    );
    const location =
      response.status >= 300 && response.status < 400 && response.headers.get('location');
    if (location) {
      try {
        response = await this.fetchWithDispatcher(location, { method: 'GET', signal });
      } catch (err) {
        throw requestFailed(err, 'OPEN');
      }
      if (!response.ok) hdfsHttpError(response.status, await response.text(), { op: 'OPEN', path });
    }
    if (!response.body) throw new Error(`HDFS OPEN returned no body for ${path}`);
    return response.body;
  }

  /**
   * Write a file in the two-step WebHDFS flow: the first PUT (no body) returns
   * a 307 to a DataNode (or back to HttpFS), the second PUT streams the data.
   */
  async create(
    path: string,
    body: ReadableStream<Uint8Array> | Uint8Array,
    options: { overwrite: boolean; signal?: AbortSignal }
  ): Promise<void> {
    log.debug({ op: 'CREATE', path }, 'WebHDFS write');
    const context = { op: 'CREATE', path };
    const first = await this.send(
      path,
      'CREATE',
      { overwrite: options.overwrite },
      { method: 'PUT', redirect: 'manual', signal: options.signal }
    );
    const location = first.headers.get('location');
    if (!location) {
      throw new Error(`HDFS CREATE for ${path} returned no redirect location`);
    }
    let result: { status: number; body: string };
    try {
      result = await this.upload(location, body, {
        signal: options.signal,
        rejectUnauthorized: !this.insecureTls,
        ...(this.ca ? { ca: this.ca } : {})
      });
    } catch (err) {
      throw requestFailed(err, 'CREATE');
    }
    if (result.status >= 300) hdfsHttpError(result.status, result.body, context);
  }

  async mkdirs(path: string): Promise<void> {
    const body = await this.json<{ boolean: boolean }>('PUT', path, 'MKDIRS');
    if (!body.boolean) throw new Error(`HDFS MKDIRS failed for ${path}`);
  }

  /** Returns `false` when HDFS refuses the rename (missing source or existing destination). */
  async rename(source: string, destination: string): Promise<boolean> {
    const body = await this.json<{ boolean: boolean }>('PUT', source, 'RENAME', { destination });
    return body.boolean;
  }

  /** Returns `false` when the path did not exist. */
  async delete(path: string, recursive: boolean): Promise<boolean> {
    const body = await this.json<{ boolean: boolean }>('DELETE', path, 'DELETE', { recursive });
    return body.boolean;
  }
}
