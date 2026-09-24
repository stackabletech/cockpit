const s3ErrorCredentialFields = [
  'AWSAccessKeyId',
  'StringToSign',
  'StringToSignBytes',
  'CanonicalRequest',
  'CanonicalRequestBytes',
  'SignatureProvided'
];

const s3ErrorPaths = s3ErrorCredentialFields.flatMap((field) => [
  `*.${field}`,
  `err.aggregateErrors[*].${field}`
]);

/** Pino redaction paths for sensitive fields. */
export const redactionPaths: string[] = [
  // S3 error bodies echoed back by the remote endpoint
  ...s3ErrorPaths,

  // Request headers
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["set-cookie"]',
  // Carries the base64 JSON S3 connection config, including secretKey.
  'req.headers["x-storage-connection"]',

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
  '*["x-storage-connection"]',
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
