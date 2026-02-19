/** Pino redaction paths for sensitive fields. */
export const redactionPaths: string[] = [
  // Request headers
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["set-cookie"]',

  // Token/credential fields (exact)
  'accessToken',
  'refreshToken',
  'idToken',
  'token',
  'access_token',
  'refresh_token',
  'id_token',
  'password',
  'secret',
  'credentials',
  'client_secret',

  // Token/credential fields (wildcard for nested objects)
  '*.authorization',
  '*.cookie',
  '*.set-cookie',
  '*.accessToken',
  '*.refreshToken',
  '*.idToken',
  '*.access_token',
  '*.refresh_token',
  '*.id_token',
  '*.password',
  '*.secret',
  '*.credentials',
  '*.client_secret',

  // Query params
  'req.query.token',
  'req.query.code',
  'req.query.access_token'
];

export const redactionCensor = '[Redacted]';
