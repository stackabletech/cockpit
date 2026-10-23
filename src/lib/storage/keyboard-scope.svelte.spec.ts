vi.mock('$lib/client/feature-flags.js', () => ({ storageTransferEnabled: true }));

vi.mock('$lib/storage/connection-store.svelte.js', () => ({
  connectionStore: { activeConnectionId: 'test-connection-id' }
}));

vi.mock('$lib/stores/toast.svelte.js', () => ({
  addToast: vi.fn()
}));

vi.mock('$app/navigation', () => ({
  invalidateAll: vi.fn()
}));

import { afterEach, describe, expect, it, vi } from 'vitest';
import { SvelteSet } from 'svelte/reactivity';
import { StorageState } from './state.svelte.js';
import { createMemoryStorageApi } from './api.test-utils.js';
import { makePage } from './state.test-utils.js';
import {
  STORAGE_SHORTCUT_SCOPE_ATTR,
  isStorageShortcutTarget,
  isTextEntryElement
} from './keyboard-scope.js';

let mounted: HTMLElement[] = [];

function mount<T extends HTMLElement>(el: T, parent: HTMLElement = document.body): T {
  parent.appendChild(el);
  if (parent === document.body) mounted.push(el);
  return el;
}

function scope(): HTMLElement {
  const div = document.createElement('div');
  div.setAttribute(STORAGE_SHORTCUT_SCOPE_ATTR, '');
  return mount(div);
}

function input(type: string, parent?: HTMLElement): HTMLInputElement {
  const el = document.createElement('input');
  el.type = type;
  return mount(el, parent);
}

afterEach(() => {
  mounted.forEach((el) => el.remove());
  mounted = [];
});

describe('isTextEntryElement', () => {
  it.each(['text', 'search', 'email', 'password', 'number', 'url'])(
    'treats <input type="%s"> as a text field',
    (type) => {
      expect(isTextEntryElement(input(type))).toBe(true);
    }
  );

  it.each(['checkbox', 'radio', 'button', 'submit'])(
    'does not treat <input type="%s"> as a text field',
    (type) => {
      expect(isTextEntryElement(input(type))).toBe(false);
    }
  );

  it('treats textarea, select and contenteditable as text fields', () => {
    const editable = mount(document.createElement('div'));
    editable.contentEditable = 'true';

    expect(isTextEntryElement(mount(document.createElement('textarea')))).toBe(true);
    expect(isTextEntryElement(mount(document.createElement('select')))).toBe(true);
    expect(isTextEntryElement(editable)).toBe(true);
  });

  it('treats anything inside a Monaco editor as a text field', () => {
    const editor = mount(document.createElement('div'));
    editor.className = 'monaco-editor';
    const inner = mount(document.createElement('div'), editor);

    expect(isTextEntryElement(inner)).toBe(true);
  });
});

describe('isStorageShortcutTarget', () => {
  it('accepts events without an element target, on body or on the document element', () => {
    expect(isStorageShortcutTarget(null)).toBe(true);
    expect(isStorageShortcutTarget(window)).toBe(true);
    expect(isStorageShortcutTarget(document.body)).toBe(true);
    expect(isStorageShortcutTarget(document.documentElement)).toBe(true);
  });

  it('accepts focusable non-text elements inside the file listing', () => {
    const list = scope();

    expect(isStorageShortcutTarget(input('checkbox', list))).toBe(true);
    expect(isStorageShortcutTarget(mount(document.createElement('button'), list))).toBe(true);
  });

  it('rejects text fields inside the file listing', () => {
    expect(isStorageShortcutTarget(input('text', scope()))).toBe(false);
  });

  it('rejects elements outside the file listing (e.g. tab bar, breadcrumbs)', () => {
    expect(isStorageShortcutTarget(mount(document.createElement('button')))).toBe(false);
    expect(isStorageShortcutTarget(input('search'))).toBe(false);
  });
});

describe('StorageState.handleKeydown scoping', () => {
  function makeState(): StorageState {
    const state = new StorageState({
      connected: true,
      buckets: ['test-bucket'],
      api: createMemoryStorageApi()
    });
    state.bucket = 'test-bucket';
    state.prefix = '';
    state.objects = makePage();
    state.selectedKeys = new SvelteSet<string>(['file.txt']);
    return state;
  }

  function keydownOn(target: HTMLElement, init: KeyboardEventInit): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(event);
    return event;
  }

  it('opens the delete modal for Delete inside the file listing', () => {
    const state = makeState();
    const checkbox = input('checkbox', scope());

    state.handleKeydown(keydownOn(checkbox, { key: 'Delete' }));

    expect(state.activeModal?.type).toBe('delete');
  });

  it('ignores Delete from a button outside the file listing (tab bar)', () => {
    const state = makeState();
    const tab = mount(document.createElement('button'));

    state.handleKeydown(keydownOn(tab, { key: 'Delete' }));

    expect(state.activeModal).toBeNull();
  });

  it('ignores Delete from a text field', () => {
    const state = makeState();
    const field = input('text', scope());

    state.handleKeydown(keydownOn(field, { key: 'Delete' }));

    expect(state.activeModal).toBeNull();
  });

  it.each(['a', 'c', 'v', 'x'])('leaves Ctrl+%s in a text field to the browser', (key) => {
    const state = makeState();
    const field = input('text', scope());

    const event = keydownOn(field, { key, ctrlKey: true });
    state.handleKeydown(event);

    expect(event.defaultPrevented).toBe(false);
    expect(state.clipboard).toBeNull();
    expect(state.selectedKeys).toEqual(new SvelteSet(['file.txt']));
  });

  it('ignores events another handler already handled', () => {
    const state = makeState();
    const event = new KeyboardEvent('keydown', { key: 'Delete', cancelable: true });
    event.preventDefault();

    state.handleKeydown(event);

    expect(state.activeModal).toBeNull();
  });
});
