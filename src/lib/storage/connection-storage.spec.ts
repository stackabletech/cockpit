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

function makeConn(overrides: Partial<StoredConnection> = {}): SavedConnection {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    type: 's3',
    endpoint: 'https://s3.example.com',
    pathStyle: true,
    region: 'eu-central-1',
    accessKeyId: 'AKIA123',
    secretAccessKey: 'secret',
    ...overrides
  } as SavedConnection;
}

describe('connection-storage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('saveConnectionLocally', () => {
    it('stores a connection and assigns the given id', () => {
      const conn = makeConn({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' });
      saveConnectionLocally(conn);
      const stored = loadAllConnectionsLocally();
      expect(stored).toHaveLength(1);
      expect(stored[0].id).toBe('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
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
      const a = makeConn({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' });
      const b = makeConn({ id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' });
      saveConnectionLocally(a);
      saveConnectionLocally(b);
      const stored = loadAllConnectionsLocally();
      expect(stored[stored.length - 1].id).toBe('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
    });

    it('replaces an existing connection with the same id and moves it to end', () => {
      const conn = makeConn({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', region: 'us-east-1' });
      saveConnectionLocally(conn);
      const updated = makeConn({
        id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        region: 'eu-west-1'
      });
      saveConnectionLocally(updated);
      const stored = loadAllConnectionsLocally();
      expect(stored).toHaveLength(1);
      expect(stored[0].region).toBe('eu-west-1');
    });
  });

  describe('updateConnectionLocally', () => {
    it('updates an existing connection in-place by id', () => {
      const a = makeConn({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', region: 'us-east-1' });
      const b = makeConn({ id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', region: 'eu-west-1' });
      saveConnectionLocally(a);
      saveConnectionLocally(b);

      updateConnectionLocally('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', { region: 'ap-south-1' });

      const stored = loadAllConnectionsLocally();
      expect(stored).toHaveLength(2);
      // Preserved position (first)
      expect(stored[0].id).toBe('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
      expect(stored[0].region).toBe('ap-south-1');
      // Second connection unchanged
      expect(stored[1].id).toBe('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
      expect(stored[1].region).toBe('eu-west-1');
    });

    it('is a no-op when the id does not exist', () => {
      const a = makeConn({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' });
      saveConnectionLocally(a);

      updateConnectionLocally('00000000-0000-0000-0000-000000000000', { region: 'us-west-2' });

      const stored = loadAllConnectionsLocally();
      expect(stored).toHaveLength(1);
      expect(stored[0].region).toBe(a.region);
    });

    it('preserves the id even when data omits it', () => {
      const conn = makeConn({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' });
      saveConnectionLocally(conn);
      updateConnectionLocally('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', { name: 'Prod' });
      const stored = loadAllConnectionsLocally();
      expect(stored[0].id).toBe('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
      expect(stored[0].name).toBe('Prod');
    });
  });

  describe('loadConnectionLocally', () => {
    it('returns null when nothing is stored', () => {
      expect(loadConnectionLocally()).toBeNull();
    });

    it('returns the last (most recently used) connection', () => {
      const a = makeConn({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' });
      const b = makeConn({ id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' });
      saveConnectionLocally(a);
      saveConnectionLocally(b);
      const loaded = loadConnectionLocally();
      expect(loaded?.id).toBe('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
    });
  });

  describe('loadAllConnectionsLocally', () => {
    it('silently drops entries without an id field', () => {
      // Write raw data including a legacy entry without id
      const legacy = {
        type: 's3',
        endpoint: 'https://old.example.com',
        pathStyle: true,
        region: 'eu-central-1',
        accessKeyId: '',
        secretAccessKey: ''
      };
      const valid = makeConn({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' });
      localStorage.setItem(STORAGE_KEY, JSON.stringify([legacy, valid]));

      const stored = loadAllConnectionsLocally();
      expect(stored).toHaveLength(1);
      expect(stored[0].id).toBe('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
    });

    it('returns an empty array when localStorage is empty', () => {
      expect(loadAllConnectionsLocally()).toEqual([]);
    });
  });

  describe('removeConnectionLocally', () => {
    it('removes a connection matched by id', () => {
      const a = makeConn({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' });
      const b = makeConn({ id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' });
      saveConnectionLocally(a);
      saveConnectionLocally(b);

      removeConnectionLocally(a);

      const stored = loadAllConnectionsLocally();
      expect(stored).toHaveLength(1);
      expect(stored[0].id).toBe('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
    });
  });

  describe('removeConnectionById', () => {
    it('removes a connection by id string', () => {
      const a = makeConn({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' });
      const b = makeConn({ id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' });
      saveConnectionLocally(a);
      saveConnectionLocally(b);

      removeConnectionById('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

      const stored = loadAllConnectionsLocally();
      expect(stored).toHaveLength(1);
      expect(stored[0].id).toBe('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
    });
  });

  describe('loadConnectionById', () => {
    it('returns the connection with the given id', () => {
      const a = makeConn({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' });
      saveConnectionLocally(a);
      const found = loadConnectionById('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
      expect(found?.id).toBe('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
    });

    it('returns null when the id does not exist', () => {
      expect(loadConnectionById('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')).toBeNull();
    });
  });
});
