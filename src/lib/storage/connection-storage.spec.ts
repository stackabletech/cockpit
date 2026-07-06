import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  saveConnectionLocally,
  updateConnectionLocally,
  loadConnectionLocally,
  loadAllConnectionsLocally,
  removeConnectionLocally,
  removeConnectionById,
  loadConnectionById
} from '$lib/storage/connection-storage.js';
import type { StoredConnection, SavedConnection } from '$lib/storage/connection-storage.js';

const STORAGE_KEY = 'stackable_storage_connections';

// localStorage is unavailable in the Node (server) test environment — stub it.
const store: Record<string, string> = {};
vi.stubGlobal('localStorage', {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, value: string) => {
    store[key] = value;
  },
  removeItem: (key: string) => {
    delete store[key];
  },
  clear: () => {
    for (const k of Object.keys(store)) delete store[k];
  }
});

// crypto.randomUUID is available in Node 15+ — ensure it is present.
if (!globalThis.crypto) {
  const { webcrypto } = await import('crypto');
  vi.stubGlobal('crypto', webcrypto);
}

function makeConn(
  overrides: Partial<Omit<SavedConnection, 'id'>> & { id?: string } = {}
): SavedConnection {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    type: 's3',
    host: 'minio.example.com',
    port: 9000,
    tls: { verification: 'Full' },
    accessStyle: 'Path',
    region: { name: 'us-east-1' },
    credentials: { accessKey: 'AKIA123', secretKey: 'secret' },
    ...overrides
  } as SavedConnection;
}

describe('connection-storage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('saveConnectionLocally', () => {
    it('stores a connection and assigns the given id', () => {
      const conn = makeConn({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
      saveConnectionLocally(conn);
      const stored = loadAllConnectionsLocally();
      expect(stored).toHaveLength(1);
      expect(stored[0].id).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    });

    it('generates a uuid when id is not set', () => {
      const conn = makeConn();
      // Simulate missing id (e.g. from legacy code path) by deleting it
      const connWithoutId = { ...conn } as Partial<StoredConnection>;
      delete connWithoutId.id;
      saveConnectionLocally(connWithoutId as StoredConnection);
      const stored = loadAllConnectionsLocally();
      expect(stored[0].id).toBeDefined();
      expect(stored[0].id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );
    });

    it('appends to the end (most recently used)', () => {
      const a = makeConn({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
      const b = makeConn({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' });
      saveConnectionLocally(a);
      saveConnectionLocally(b);
      const stored = loadAllConnectionsLocally();
      expect(stored[stored.length - 1].id).toBe('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    });

    it('replaces an existing connection with the same id and moves it to end', () => {
      const conn = makeConn({
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        region: { name: 'us-east-1' }
      });
      saveConnectionLocally(conn);
      const updated = makeConn({
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        region: { name: 'eu-west-1' }
      });
      saveConnectionLocally(updated);
      const stored = loadAllConnectionsLocally();
      expect(stored).toHaveLength(1);
      expect(stored[0].region.name).toBe('eu-west-1');
    });

    it('deduplicates by host+port+accessKey when no id is supplied', () => {
      // First save — assigns a UUID
      const connWithoutId = {
        type: 's3' as const,
        host: 'minio.example.com',
        port: 9000,
        tls: { verification: 'Full' as const },
        accessStyle: 'Path' as const,
        region: { name: 'us-east-1' },
        credentials: { accessKey: 'AKIA123', secretKey: 'secret' }
      };
      saveConnectionLocally(connWithoutId);
      const afterFirst = loadAllConnectionsLocally();
      expect(afterFirst).toHaveLength(1);
      const assignedId = afterFirst[0].id;

      // Second save with same identity but no id — should reuse the existing entry
      saveConnectionLocally({ ...connWithoutId, region: { name: 'eu-west-1' } });
      const afterSecond = loadAllConnectionsLocally();
      expect(afterSecond).toHaveLength(1);
      expect(afterSecond[0].id).toBe(assignedId);
      expect(afterSecond[0].region.name).toBe('eu-west-1');
    });
  });

  describe('updateConnectionLocally', () => {
    it('updates an existing connection in-place by id', () => {
      const a = makeConn({
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        region: { name: 'us-east-1' }
      });
      const b = makeConn({
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        region: { name: 'eu-west-1' }
      });
      saveConnectionLocally(a);
      saveConnectionLocally(b);

      updateConnectionLocally('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', {
        region: { name: 'ap-south-1' }
      });

      const stored = loadAllConnectionsLocally();
      expect(stored).toHaveLength(2);
      // Preserved position (first)
      expect(stored[0].id).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
      expect(stored[0].region.name).toBe('ap-south-1');
      // Second connection unchanged
      expect(stored[1].id).toBe('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
      expect(stored[1].region.name).toBe('eu-west-1');
    });

    it('is a no-op when the id does not exist', () => {
      const a = makeConn({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
      saveConnectionLocally(a);

      updateConnectionLocally('00000000-0000-0000-0000-000000000000', {
        region: { name: 'us-west-2' }
      });

      const stored = loadAllConnectionsLocally();
      expect(stored).toHaveLength(1);
      expect(stored[0].region.name).toBe(a.region.name);
    });

    it('preserves the id even when data omits it', () => {
      const conn = makeConn({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
      saveConnectionLocally(conn);
      updateConnectionLocally('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', { name: 'Prod' });
      const stored = loadAllConnectionsLocally();
      expect(stored[0].id).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
      expect(stored[0].name).toBe('Prod');
    });
  });

  describe('loadConnectionLocally', () => {
    it('returns null when nothing is stored', () => {
      expect(loadConnectionLocally()).toBeNull();
    });

    it('returns the last (most recently used) connection', () => {
      const a = makeConn({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
      const b = makeConn({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' });
      saveConnectionLocally(a);
      saveConnectionLocally(b);
      const loaded = loadConnectionLocally();
      expect(loaded?.id).toBe('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    });
  });

  describe('loadAllConnectionsLocally', () => {
    it('silently drops entries that fail schema validation (clean break)', () => {
      // Write raw data including a legacy entry with old schema fields
      const legacy = {
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        type: 's3',
        endpoint: 'https://old.example.com',
        pathStyle: true,
        region: 'eu-central-1',
        accessKeyId: '',
        secretAccessKey: ''
      };
      const valid = makeConn({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
      localStorage.setItem(STORAGE_KEY, JSON.stringify([legacy, valid]));

      const stored = loadAllConnectionsLocally();
      expect(stored).toHaveLength(1);
      expect(stored[0].id).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    });

    it('returns an empty array when localStorage is empty', () => {
      expect(loadAllConnectionsLocally()).toEqual([]);
    });
  });

  describe('removeConnectionLocally', () => {
    it('removes a connection matched by id', () => {
      const a = makeConn({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
      const b = makeConn({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' });
      saveConnectionLocally(a);
      saveConnectionLocally(b);

      removeConnectionLocally(a);

      const stored = loadAllConnectionsLocally();
      expect(stored).toHaveLength(1);
      expect(stored[0].id).toBe('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    });
  });

  describe('removeConnectionById', () => {
    it('removes a connection by id string', () => {
      const a = makeConn({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
      const b = makeConn({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' });
      saveConnectionLocally(a);
      saveConnectionLocally(b);

      removeConnectionById('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');

      const stored = loadAllConnectionsLocally();
      expect(stored).toHaveLength(1);
      expect(stored[0].id).toBe('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    });
  });

  describe('loadConnectionById', () => {
    it('returns the connection with the given id', () => {
      const a = makeConn({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
      saveConnectionLocally(a);
      const found = loadConnectionById('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
      expect(found?.id).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    });

    it('returns null when the id does not exist', () => {
      expect(loadConnectionById('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')).toBeNull();
    });
  });
});
