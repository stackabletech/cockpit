import { describe, it, expect, afterEach, vi } from 'vitest';
import { randomUUID } from '$lib/utils/uuid.js';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// Captured before any stubbing so the uniqueness test uses real randomness.
const realGetRandomValues = crypto.getRandomValues.bind(crypto);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('randomUUID', () => {
  it('uses crypto.randomUUID when it is available', () => {
    const spy = vi.fn(() => '11111111-2222-4333-8444-555555555555');
    vi.stubGlobal('crypto', { randomUUID: spy, getRandomValues: () => undefined });

    expect(randomUUID()).toBe('11111111-2222-4333-8444-555555555555');
    expect(spy).toHaveBeenCalledOnce();
  });

  // `crypto.randomUUID` is only exposed in secure contexts, so it is undefined
  // when the app is served over plain HTTP on a non-localhost host.
  it('falls back to getRandomValues when crypto.randomUUID is unavailable', () => {
    vi.stubGlobal('crypto', { getRandomValues: <T>(array: T) => array });

    const id = randomUUID();

    expect(id).toMatch(UUID_V4);
  });

  it('stamps version 4 and the RFC 4122 variant bits', () => {
    // All-zero bytes: the version and variant nibbles must still be forced.
    vi.stubGlobal('crypto', {
      getRandomValues: (array: Uint8Array) => array.fill(0)
    });

    const id = randomUUID();

    expect(id).toBe('00000000-0000-4000-8000-000000000000');
  });

  it('sets the variant nibble to one of 8, 9, a or b', () => {
    vi.stubGlobal('crypto', {
      // 0xff sets every nibble, including version and variant.
      getRandomValues: (array: Uint8Array) => array.fill(0xff)
    });

    const variantNibble = randomUUID().split('-')[3]![0];

    expect(['8', '9', 'a', 'b']).toContain(variantNibble);
  });

  it('produces distinct ids across calls', () => {
    vi.stubGlobal('crypto', { getRandomValues: realGetRandomValues });

    const ids = new Set(Array.from({ length: 100 }, () => randomUUID()));

    expect(ids.size).toBe(100);
  });
});
