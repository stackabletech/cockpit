import { randomUUID } from 'node:crypto';

/** Port of the mock Trino server (see start-mock-trino.ts). */
export const MOCK_TRINO_PORT = 18080;
/** Must match STACKABLE_COCKPIT_TRINO_URL in .env.test. */
export const MOCK_TRINO_URL = `http://localhost:${MOCK_TRINO_PORT}`;

export interface MockTrinoLogEntry {
  event: 'submitted' | 'cancelled';
  sql: string;
  queryId: string;
}

/**
 * Unique marker to embed in test SQL. All browser projects share one mock
 * server, so log lookups must be scoped to the statements of a single test.
 */
export function mockMarker(): string {
  return randomUUID();
}

/** Statements containing `marker` that reached the mock, and their cancellations. */
export async function mockTrinoLog(marker: string): Promise<MockTrinoLogEntry[]> {
  const res = await fetch(`${MOCK_TRINO_URL}/__mock/log?marker=${encodeURIComponent(marker)}`);
  if (!res.ok) {
    throw new Error(`Mock Trino log request failed: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as MockTrinoLogEntry[];
}

/** SQL of the statements containing `marker` that recorded the given event. */
export async function mockTrinoStatements(
  marker: string,
  event: MockTrinoLogEntry['event']
): Promise<string[]> {
  return (await mockTrinoLog(marker)).filter((e) => e.event === event).map((e) => e.sql);
}

/** Release a `GATE:<id>` submit or a `HOLD:<id>` query. */
export async function releaseMockTrino(id: string): Promise<void> {
  await fetch(`${MOCK_TRINO_URL}/__mock/release/${encodeURIComponent(id)}`, { method: 'POST' });
}
