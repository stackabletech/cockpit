import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { Writable } from 'node:stream';
import pino from 'pino';

// Create a test logger that captures output
function createTestLogger() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    }
  });

  const log = pino({ level: 'trace' }, stream);
  return { log, lines };
}

// Mock the logger module before importing request-logger
const { log: testLogger, lines: logLines } = createTestLogger();

vi.mock('./logger.js', () => ({
  logger: testLogger
}));

const { requestLogger } = await import('./request-logger.js');

function createMockEvent(overrides: Partial<RequestEvent> = {}): RequestEvent {
  const headers = new Headers();
  const url = new URL('http://localhost:3000/test');

  return {
    request: new Request(url, { method: 'GET', headers }),
    url,
    locals: {} as App.Locals,
    params: {},
    route: { id: '/test' },
    cookies: {} as RequestEvent['cookies'],
    fetch: globalThis.fetch,
    getClientAddress: () => '127.0.0.1',
    isDataRequest: false,
    isSubRequest: false,
    platform: undefined,
    ...overrides
  } as RequestEvent;
}

describe('requestLogger', () => {
  beforeEach(() => {
    logLines.length = 0;
  });

  it('generates a request ID when x-request-id header is absent', async () => {
    const event = createMockEvent();
    const resolve = vi.fn(async () => new Response('ok', { status: 200 }));

    const response = await requestLogger({ event, resolve });

    expect(response.headers.get('x-request-id')).toBeTruthy();
    expect(event.locals.requestId).toBeTruthy();
    // Should be a UUID format
    expect(event.locals.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  it('preserves incoming x-request-id header', async () => {
    const headers = new Headers({ 'x-request-id': 'incoming-id-123' });
    const event = createMockEvent({
      request: new Request('http://localhost:3000/test', { headers })
    });
    const resolve = vi.fn(async () => new Response('ok', { status: 200 }));

    const response = await requestLogger({ event, resolve });

    expect(event.locals.requestId).toBe('incoming-id-123');
    expect(response.headers.get('x-request-id')).toBe('incoming-id-123');
  });

  it('echoes request ID in response header', async () => {
    const event = createMockEvent();
    const resolve = vi.fn(async () => new Response('ok', { status: 200 }));

    const response = await requestLogger({ event, resolve });

    expect(response.headers.get('x-request-id')).toBe(event.locals.requestId);
  });

  it('attaches logger to event.locals', async () => {
    const event = createMockEvent();
    const resolve = vi.fn(async () => new Response('ok', { status: 200 }));

    await requestLogger({ event, resolve });

    expect(event.locals.logger).toBeDefined();
    expect(typeof event.locals.logger.info).toBe('function');
    expect(typeof event.locals.logger.debug).toBe('function');
    expect(typeof event.locals.logger.error).toBe('function');
  });

  it('logs at trace level for 2xx responses', async () => {
    const event = createMockEvent();
    const resolve = vi.fn(async () => new Response('ok', { status: 200 }));

    await requestLogger({ event, resolve });
    testLogger.flush();

    const completionLog = logLines.map((l) => JSON.parse(l)).find((l) => l.status_code === 200);
    expect(completionLog).toBeDefined();
    // pino numeric levels: trace=10, debug=20, info=30, warn=40, error=50
    expect(completionLog.level).toBe(10);
  });

  it('logs at trace level for 3xx responses', async () => {
    const event = createMockEvent();
    const resolve = vi.fn(async () => new Response(null, { status: 302 }));

    await requestLogger({ event, resolve });
    testLogger.flush();

    const completionLog = logLines.map((l) => JSON.parse(l)).find((l) => l.status_code === 302);
    expect(completionLog).toBeDefined();
    expect(completionLog.level).toBe(10);
  });

  it('logs at info level for 4xx responses', async () => {
    const event = createMockEvent();
    const resolve = vi.fn(async () => new Response('not found', { status: 404 }));

    await requestLogger({ event, resolve });
    testLogger.flush();

    const completionLog = logLines.map((l) => JSON.parse(l)).find((l) => l.status_code === 404);
    expect(completionLog).toBeDefined();
    expect(completionLog.level).toBe(30);
  });

  it('logs at error level for 5xx responses', async () => {
    const event = createMockEvent();
    const resolve = vi.fn(async () => new Response('error', { status: 500 }));

    await requestLogger({ event, resolve });
    testLogger.flush();

    const completionLog = logLines.map((l) => JSON.parse(l)).find((l) => l.status_code === 500);
    expect(completionLog).toBeDefined();
    expect(completionLog.level).toBe(50);
  });

  it('includes duration_ms in completion log', async () => {
    const event = createMockEvent();
    const resolve = vi.fn(async () => new Response('ok', { status: 200 }));

    await requestLogger({ event, resolve });
    testLogger.flush();

    const completionLog = logLines
      .map((l) => JSON.parse(l))
      .find((l) => l.msg === 'Request completed');
    expect(completionLog).toBeDefined();
    expect(typeof completionLog.duration_ms).toBe('number');
    expect(completionLog.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it('includes request context in log entries', async () => {
    const event = createMockEvent();
    const resolve = vi.fn(async () => new Response('ok', { status: 200 }));

    await requestLogger({ event, resolve });
    testLogger.flush();

    const entry = JSON.parse(logLines[0]);
    expect(entry.request_id).toBeTruthy();
    expect(entry.method).toBe('GET');
    expect(entry.path).toBe('/test');
  });
});
