import { X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { getCACertificates, setDefaultCACertificates } from 'node:tls';
import { z } from 'zod';
import { envList, parseEnv } from '../env-schema.js';

// Kept free of SvelteKit imports: drizzle.config.ts uses it outside Vite.

const CA_CERTS_VARIABLE = 'STACKABLE_COCKPIT_TLS_CA_CERTS';

const PEM_CERTIFICATE = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g;

const schema = z.object({ [CA_CERTS_VARIABLE]: envList([]) });

export interface TrustedCaFile {
  path: string;
  certificates: number;
}

/** Reads and validates the PEM certificates in `path`, normalised to Node's PEM format. */
function readCaFile(path: string): string[] {
  let pem: string;
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- CA certificate path from the deployment configuration
    pem = readFileSync(path, 'utf8');
  } catch (err) {
    throw new Error(`${CA_CERTS_VARIABLE}: cannot read ${path}: ${(err as Error).message}`, {
      cause: err
    });
  }
  const blocks = pem.match(PEM_CERTIFICATE) ?? [];
  if (blocks.length === 0) {
    throw new Error(`${CA_CERTS_VARIABLE}: ${path} contains no PEM certificate`);
  }
  return blocks.map((block, index) => {
    try {
      return new X509Certificate(block).toString();
    } catch (err) {
      throw new Error(
        `${CA_CERTS_VARIABLE}: certificate ${index + 1} in ${path} is invalid: ${(err as Error).message}`,
        { cause: err }
      );
    }
  });
}

/**
 * Adds the CA certificates listed in `STACKABLE_COCKPIT_TLS_CA_CERTS` (comma-separated PEM
 * files) to the default trust store of the process. Every TLS client that doesn't set its
 * own `ca` uses it: fetch (OIDC provider, Trino), node-postgres and the S3 HTTPS agent. The
 * CAs bundled with Node.js stay trusted, so public endpoints keep working.
 *
 * Throws on a missing, empty or invalid file, so a broken CA fails at startup instead of on
 * the first connection. Calling it again with the same files changes nothing.
 */
export function trustCaCerts(env: Record<string, string | undefined>): TrustedCaFile[] {
  const paths = parseEnv(schema, env)[CA_CERTS_VARIABLE];
  const files = paths.map((path) => ({ path, certificates: readCaFile(path) }));
  if (files.length > 0) {
    const certificates = files.flatMap((file) => file.certificates);
    setDefaultCACertificates([...new Set([...getCACertificates('default'), ...certificates])]);
  }
  return files.map(({ path, certificates }) => ({ path, certificates: certificates.length }));
}
