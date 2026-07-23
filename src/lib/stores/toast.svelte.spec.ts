import { describe, it, expect, vi, beforeEach } from 'vitest';
import { toasts, addToast, removeToast } from './toast.svelte.js';

beforeEach(() => {
  toasts.length = 0;
});

describe('addToast', () => {
  it('adds a toast with the given properties', () => {
    const id = addToast('info', 'Hello world');
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toMatchObject({ type: 'info', message: 'Hello world' });
    expect(typeof toasts[0].id).toBe('string');
  });

  it('returns a unique id', () => {
    const id1 = addToast('info', 'First');
    const id2 = addToast('success', 'Second');
    expect(id1).not.toBe(id2);
  });

  it('removes toast after duration', async () => {
    vi.useFakeTimers();
    addToast('info', 'Timed', 100);
    expect(toasts).toHaveLength(1);
    vi.advanceTimersByTime(100);
    expect(toasts).toHaveLength(0);
    vi.useRealTimers();
  });

  it('does not auto-remove when duration is 0', async () => {
    vi.useFakeTimers();
    addToast('info', 'Persistent', 0);
    vi.advanceTimersByTime(999999);
    expect(toasts).toHaveLength(1);
    vi.useRealTimers();
  });

  it('stores actions when provided', () => {
    const action = { label: 'Undo', onClick: () => {} };
    const id = addToast('warning', 'With action', 5000, [action]);
    expect(toasts[0].actions).toEqual([action]);
  });
});

describe('removeToast', () => {
  it('removes a toast by id', () => {
    const id = addToast('error', 'Remove me');
    expect(toasts).toHaveLength(1);
    removeToast(id);
    expect(toasts).toHaveLength(0);
  });

  it('does nothing when id does not exist', () => {
    addToast('info', 'Stay');
    removeToast('non-existent-id');
    expect(toasts).toHaveLength(1);
  });
});

describe('toasts reactivity', () => {
  it('starts empty', () => {
    expect(toasts).toEqual([]);
  });

  it('toast order is LIFO (push order)', () => {
    addToast('info', 'First');
    addToast('success', 'Second');
    expect(toasts[0].message).toBe('First');
    expect(toasts[1].message).toBe('Second');
  });
});
