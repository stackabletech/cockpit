import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import * as m from '$lib/paraglide/messages.js';
import { getLocale, setLocale } from '$lib/paraglide/runtime.js';

// Monaco is replaced by a minimal stub so the test only checks how
// TextEditor registers its save action, not Monaco itself.
const addAction = vi.hoisted(() => vi.fn());

vi.mock('monaco-editor/esm/vs/editor/editor.worker?worker', () => ({
  default: class {}
}));

vi.mock('monaco-editor', () => ({
  KeyMod: { CtrlCmd: 1 << 11, Shift: 1 << 10 },
  KeyCode: {
    KeyS: 49,
    Equal: 86,
    Minus: 88,
    NumpadAdd: 109,
    NumpadSubtract: 111,
    Digit0: 21,
    Numpad0: 98
  },
  editor: {
    setTheme: vi.fn(),
    addKeybindingRules: vi.fn(() => ({ dispose: vi.fn() })),
    create: vi.fn(() => ({
      focus: vi.fn(),
      onDidChangeModelContent: vi.fn(),
      addAction,
      getValue: vi.fn(() => ''),
      hasTextFocus: vi.fn(() => false),
      trigger: vi.fn(),
      dispose: vi.fn()
    }))
  }
}));

import TextEditor from './TextEditor.svelte';

describe('TextEditor', () => {
  const initialLocale = getLocale();

  afterEach(() => {
    setLocale(initialLocale, { reload: false });
    addAction.mockClear();
  });

  it('labels the save action with the translated message', async () => {
    render(TextEditor, { value: 'hello', filename: 'a.txt', onSave: () => {} });

    await vi.waitFor(() => expect(addAction).toHaveBeenCalled());
    expect(addAction).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'save-file', label: m.storage_editor_save_action() })
    );
  });

  it('uses the active locale for the save action label', async () => {
    setLocale('de', { reload: false });
    render(TextEditor, { value: 'hallo', filename: 'a.txt', onSave: () => {} });

    await vi.waitFor(() => expect(addAction).toHaveBeenCalled());
    expect(addAction).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'save-file', label: 'Datei speichern' })
    );
  });
});
