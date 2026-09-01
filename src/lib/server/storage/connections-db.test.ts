import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  deleteWhere: vi.fn(),
  transaction: vi.fn()
}));

vi.mock('$lib/server/db.js', () => ({
  db: {
    transaction: mocks.transaction
  }
}));

import { deleteConnection } from './connections-db.js';

describe('deleteConnection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.deleteWhere.mockResolvedValue(undefined);
    mocks.transaction.mockImplementation(async (callback) =>
      callback({ delete: () => ({ where: mocks.deleteWhere }) })
    );
  });

  it('atomically deletes only the owned connection history before the connection', async () => {
    await deleteConnection('user-1', '00000000-0000-4000-8000-000000000001');

    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.deleteWhere).toHaveBeenCalledTimes(2);
    expect(mocks.deleteWhere.mock.calls[0]?.[0]).toBeDefined();
    expect(mocks.deleteWhere.mock.calls[1]?.[0]).toBeDefined();
  });
});
