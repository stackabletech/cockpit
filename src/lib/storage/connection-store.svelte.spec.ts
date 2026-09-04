import { describe, it, expect } from 'vitest';
import {
  connectionHostname,
  connectionStore,
  type ConnectionListItem
} from './connection-store.svelte.js';

describe('connectionStore', () => {
  it('extracts the hostname from a connection endpoint', () => {
    expect(connectionHostname({ endpoint: 's3.example.com:9000' } as ConnectionListItem)).toBe(
      's3.example.com'
    );
  });
  it('starts with null activeConnectionId', () => {
    expect(connectionStore.activeConnectionId).toBeNull();
  });

  it('starts with empty connections', () => {
    expect(connectionStore.connections).toEqual([]);
  });

  it('activeConnection returns null when no connection is active', () => {
    expect(connectionStore.activeConnection).toBeNull();
  });

  it('activeConnection returns null when activeConnectionId does not match any connection', () => {
    connectionStore.activeConnectionId = 'non-existent';
    expect(connectionStore.activeConnection).toBeNull();
  });

  it('activeConnection returns matching connection', () => {
    const conn: ConnectionListItem = {
      id: 'conn-1',
      name: 'My S3',
      endpoint: 's3.example.com',
      additionalBuckets: [],
      createdAt: '2024-01-01',
      updatedAt: '2024-01-02'
    };
    connectionStore.connections.push(conn);
    connectionStore.activeConnectionId = 'conn-1';
    expect(connectionStore.activeConnection).toEqual(conn);
  });

  it('handles switching activeConnectionId', () => {
    const conn1: ConnectionListItem = {
      id: 'c1',
      name: 'First',
      endpoint: null,
      additionalBuckets: [],
      createdAt: '',
      updatedAt: ''
    };
    const conn2: ConnectionListItem = {
      id: 'c2',
      name: 'Second',
      endpoint: null,
      additionalBuckets: [],
      createdAt: '',
      updatedAt: ''
    };
    connectionStore.connections.push(conn1, conn2);
    connectionStore.activeConnectionId = 'c1';
    expect(connectionStore.activeConnection?.name).toBe('First');
    connectionStore.activeConnectionId = 'c2';
    expect(connectionStore.activeConnection?.name).toBe('Second');
  });
});
