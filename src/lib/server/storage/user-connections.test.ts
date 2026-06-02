import { describe, it, expect, vi, beforeEach } from 'vitest';
import { faker } from '@faker-js/faker';
import { setUserConnection, getUserConnection, clearUserConnection } from './user-connections.js';
import type { S3ConnectionConfig } from './types.js';

vi.mock('$lib/server/logging', () => ({
  logger: { child: () => ({ info: vi.fn(), debug: vi.fn() }) }
}));

function makeConfig(): S3ConnectionConfig {
  return {
    type: 's3',
    region: faker.location.countryCode(),
    endpoint: faker.internet.url(),
    accessKeyId: faker.string.alphanumeric(20),
    secretAccessKey: faker.string.alphanumeric(40)
  };
}

describe('user-connections', () => {
  const userId = faker.string.uuid();

  beforeEach(() => {
    clearUserConnection(userId);
  });

  it('returns null for unknown user', () => {
    expect(getUserConnection(faker.string.uuid())).toBeNull();
  });

  it('stores and retrieves a connection', () => {
    const config = makeConfig();
    setUserConnection(userId, config);
    expect(getUserConnection(userId)).toEqual(config);
  });

  it('overwrites existing connection', () => {
    setUserConnection(userId, makeConfig());
    const newConfig = makeConfig();
    setUserConnection(userId, newConfig);
    expect(getUserConnection(userId)).toEqual(newConfig);
  });

  it('clears a connection', () => {
    setUserConnection(userId, makeConfig());
    clearUserConnection(userId);
    expect(getUserConnection(userId)).toBeNull();
  });

  it('clearing non-existent user does not throw', () => {
    expect(() => clearUserConnection(faker.string.uuid())).not.toThrow();
  });

  it('supports multiple users independently', () => {
    const user1 = faker.string.uuid();
    const user2 = faker.string.uuid();
    const config1 = makeConfig();
    const config2 = makeConfig();
    setUserConnection(user1, config1);
    setUserConnection(user2, config2);
    expect(getUserConnection(user1)).toEqual(config1);
    expect(getUserConnection(user2)).toEqual(config2);
    clearUserConnection(user1);
    expect(getUserConnection(user1)).toBeNull();
    expect(getUserConnection(user2)).toEqual(config2);
  });
});
