import { readFileSync } from 'node:fs';
import { S3Client } from '@aws-sdk/client-s3';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { Agent as HttpAgent } from 'http';
import { Agent as HttpsAgent } from 'https';
import { logger } from '$lib/server/logging';
import { storageTlsCaCertPath } from './config.js';
import type { S3ConnectionConfig } from './types.js';

const log = logger.child({ module: 's3-client' });

/**
 * Reads the CA certificate for verified S3 connections. When set, it replaces the CAs
 * bundled with Node.js, like the Trino and database CA settings.
 */
function loadCaCert(): Buffer | undefined {
  const path = storageTlsCaCertPath;
  if (!path) return undefined;
  let ca: Buffer;
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- CA certificate path from the deployment configuration
    ca = readFileSync(path);
  } catch (err) {
    throw new Error(
      `Cannot read STACKABLE_COCKPIT_STORAGE_TLS_CA_CERT (${path}): ${(err as Error).message}`,
      { cause: err }
    );
  }
  log.info({ ca_cert_path: path }, 'using custom CA certificate for S3 connections');
  return ca;
}

// A client is created per request. Sharing the agents lets those clients reuse
// pooled connections instead of each leaving its own idle keep-alive sockets
// open, which exhausted file descriptors on both the app and the S3 server.
// `timeout` only closes idle pooled sockets; active streams are unaffected.
const agentOptions = { keepAlive: true, maxFreeSockets: 64, timeout: 30_000 };
const caCert = loadCaCert();
const httpAgent = new HttpAgent(agentOptions);
const httpsAgent = new HttpsAgent({ ...agentOptions, ...(caCert && { ca: caCert }) });
const unverifiedHttpsAgent = new HttpsAgent({ ...agentOptions, rejectUnauthorized: false });

function buildEndpointUrl(config: S3ConnectionConfig): string {
  const scheme = config.tls ? 'https' : 'http';
  const portSuffix = config.port ? `:${config.port}` : '';
  return `${scheme}://${config.host}${portSuffix}`;
}

export function createS3Client(config: S3ConnectionConfig): S3Client {
  return new S3Client({
    region: config.region.name,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    endpoint: buildEndpointUrl(config),
    forcePathStyle: config.accessStyle === 'Path',
    requestHandler: new NodeHttpHandler({
      httpAgent,
      httpsAgent: config.tls?.verification === 'None' ? unverifiedHttpsAgent : httpsAgent
    }),
    ...(config.credentials && {
      credentials: {
        accessKeyId: config.credentials.accessKey,
        secretAccessKey: config.credentials.secretKey
      }
    })
  });
}
