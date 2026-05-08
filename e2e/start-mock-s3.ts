/**
 * Minimal S3-compatible mock server for E2E tests.
 *
 * Handles the subset of the S3 API that the storage provider uses:
 *   - ListBuckets    (GET /)
 *   - ListObjectsV2  (GET /<bucket>?list-type=2&...)
 *   - HeadObject     (HEAD /<bucket>/<key>)
 *   - GetObject      (GET  /<bucket>/<key>  — supports Range header)
 *
 * All operations use path-style addressing (forcePathStyle=true in the SDK).
 */

import * as http from 'node:http';

const PORT = 9191;
const BUCKET = 'test-bucket';

// ── Static file fixtures ───────────────────────────────────────────────────

interface Fixture {
  contentType: string;
  content: Buffer;
}

const TEXT_CONTENT = Buffer.from('Hello, World!\nThis is a preview test file.', 'utf-8');
const JSON_CONTENT = Buffer.from(
  JSON.stringify({ name: 'Alice', role: 'engineer', team: 'data' }, null, 2),
  'utf-8'
);
const CSV_CONTENT = Buffer.from(
  ['id,name,role', '1,Alice,engineer', '2,Bob,analyst', '3,Carol,manager'].join('\n'),
  'utf-8'
);
// Minimal 1×1 red PNG (68 bytes)
const PNG_CONTENT = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);
// Fake gzip header (non-UTF-8, binary)
const BINARY_CONTENT = Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0xde, 0xad, 0xbe, 0xef]);

const FIXTURES: Record<string, Fixture> = {
  'hello.txt': { contentType: 'text/plain', content: TEXT_CONTENT },
  'data.json': { contentType: 'application/json', content: JSON_CONTENT },
  'data.csv': { contentType: 'text/csv', content: CSV_CONTENT },
  'image.png': { contentType: 'image/png', content: PNG_CONTENT },
  'archive.bin': { contentType: 'application/octet-stream', content: BINARY_CONTENT },
  // Large text file (> 256 KiB) — used to test truncation
  'large.txt': {
    contentType: 'text/plain',
    content: Buffer.from('A'.repeat(300 * 1024), 'utf-8')
  }
};

// ── XML helpers ────────────────────────────────────────────────────────────

function listBucketsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ListAllMyBucketsResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Owner><ID>test-owner</ID><DisplayName>test</DisplayName></Owner>
  <Buckets>
    <Bucket>
      <Name>${BUCKET}</Name>
      <CreationDate>2026-01-01T00:00:00.000Z</CreationDate>
    </Bucket>
  </Buckets>
</ListAllMyBucketsResult>`;
}

function listObjectsXml(prefix: string): string {
  const entries = Object.entries(FIXTURES)
    .filter(([key]) => key.startsWith(prefix))
    .map(
      ([key, f]) => `
  <Contents>
    <Key>${key}</Key>
    <Size>${f.content.length}</Size>
    <LastModified>2026-01-01T00:00:00.000Z</LastModified>
    <ETag>"test-etag-${key}"</ETag>
    <StorageClass>STANDARD</StorageClass>
  </Contents>`
    )
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Name>${BUCKET}</Name>
  <Prefix>${prefix}</Prefix>
  <Delimiter>/</Delimiter>
  <MaxKeys>100</MaxKeys>
  <IsTruncated>false</IsTruncated>
  ${entries}
</ListBucketResult>`;
}

function errorXml(code: string, message: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Error>
  <Code>${code}</Code>
  <Message>${message}</Message>
</Error>`;
}

// ── Request handler ────────────────────────────────────────────────────────

http
  .createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
    const pathParts = url.pathname.slice(1).split('/');
    const bucket = pathParts[0];
    const key = pathParts.slice(1).join('/');

    // ListBuckets: GET /
    if (req.method === 'GET' && !bucket) {
      res.writeHead(200, { 'Content-Type': 'application/xml' });
      res.end(listBucketsXml());
      return;
    }

    // ListObjectsV2: GET /<bucket>?list-type=2
    if (req.method === 'GET' && bucket === BUCKET && !key && url.searchParams.has('list-type')) {
      const prefix = url.searchParams.get('prefix') ?? '';
      res.writeHead(200, { 'Content-Type': 'application/xml' });
      res.end(listObjectsXml(prefix));
      return;
    }

    // HeadObject / GetObject: HEAD or GET /<bucket>/<key>
    if ((req.method === 'HEAD' || req.method === 'GET') && bucket === BUCKET && key) {
      // Simulate 403 for a specific test key
      if (key === 'no-access.txt') {
        res.writeHead(403, { 'Content-Type': 'application/xml' });
        res.end(errorXml('AccessDenied', 'Access Denied'));
        return;
      }

      const fixture = FIXTURES[key];
      if (!fixture) {
        res.writeHead(404, { 'Content-Type': 'application/xml' });
        res.end(errorXml('NoSuchKey', 'The specified key does not exist.'));
        return;
      }

      // Parse Range header
      const rangeHeader = req.headers['range'];
      if (rangeHeader && req.method === 'GET') {
        const match = /^bytes=(\d+)-(\d+)$/.exec(rangeHeader);
        if (match) {
          const start = parseInt(match[1], 10);
          const end = Math.min(parseInt(match[2], 10), fixture.content.length - 1);
          const chunk = fixture.content.slice(start, end + 1);
          res.writeHead(206, {
            'Content-Type': fixture.contentType,
            'Content-Length': String(chunk.length),
            'Content-Range': `bytes ${start}-${end}/${fixture.content.length}`,
            'Accept-Ranges': 'bytes'
          });
          res.end(chunk);
          return;
        }
      }

      if (req.method === 'HEAD') {
        res.writeHead(200, {
          'Content-Type': fixture.contentType,
          'Content-Length': String(fixture.content.length),
          'Last-Modified': 'Wed, 01 Jan 2026 00:00:00 GMT',
          ETag: `"test-etag-${key}"`
        });
        res.end();
        return;
      }

      // Full GET
      res.writeHead(200, {
        'Content-Type': fixture.contentType,
        'Content-Length': String(fixture.content.length),
        'Last-Modified': 'Wed, 01 Jan 2026 00:00:00 GMT',
        ETag: `"test-etag-${key}"`
      });
      res.end(fixture.content);
      return;
    }

    // Fallback
    res.writeHead(404, { 'Content-Type': 'application/xml' });
    res.end(errorXml('NoSuchBucket', 'The specified bucket does not exist.'));
  })
  .listen(PORT, 'localhost', () => console.log(`Mock S3 on :${PORT}`));
