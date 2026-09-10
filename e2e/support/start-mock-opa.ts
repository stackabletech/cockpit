import * as http from 'node:http';

export const MOCK_OPA_PORT = 9191;

interface OpaInput {
  user?: {
    id?: string;
    email?: string;
    username?: string | null;
  };
}

// Hardcoded admin user IDs — mirrors dev/opa/policies/admin.rego.
const ADMIN_USER_IDS = new Set(['admin-user-id-1', 'admin-user-id-2']);

/**
 * Mirrors the `stackable/admin` rule in `dev/opa/policies/admin.rego`:
 * a user is an admin when their ID is in the hardcoded admin list or their
 * email ends with `@admin.example.com`.
 */
function isAdmin(input: OpaInput): boolean {
  const { id, email } = input.user ?? {};
  if (id && ADMIN_USER_IDS.has(id)) return true;
  if (email?.endsWith('@admin.example.com')) return true;
  return false;
}

/**
 * Minimal stand-in for a real OPA server. Implements just enough of the OPA
 * Data API that the `@open-policy-agent/opa` SDK client uses: `POST /v1/data/<path>`
 * with a JSON body `{ "input": ... }` returns `{ "result": <value> }`.
 *
 * GET requests also return 200 so Playwright can use the endpoint as a
 * readiness probe for the webServer.
 */
http
  .createServer((req, res) => {
    if (!req.url?.startsWith('/v1/data/')) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
      return;
    }

    const respond = (result: unknown) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ result }));
    };

    if (req.method !== 'POST') {
      respond(false);
      return;
    }

    let body = '';
    req.on('data', (c: Buffer) => (body += c));
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body || '{}') as { input?: OpaInput };
        respond(isAdmin(parsed.input ?? {}));
      } catch {
        respond(false);
      }
    });
  })
  .listen(MOCK_OPA_PORT, 'localhost', () => console.log(`Mock OPA on :${MOCK_OPA_PORT}`));
