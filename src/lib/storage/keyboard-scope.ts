/**
 * Scope rules for the file browser's global keyboard shortcuts
 * (Delete, Escape, F2, Ctrl+A/C/V/X).
 *
 * The shortcuts are registered on `window`, so without these checks they
 * would hijack native behaviour everywhere on the page (copying text from an
 * input, pressing Delete in the tab bar, …).
 */

/** Attribute marking the element whose descendants may trigger the shortcuts. */
export const STORAGE_SHORTCUT_SCOPE_ATTR = 'data-storage-shortcut-scope';

/** `<input>` types that do not accept free text, so shortcuts stay active on them. */
const NON_TEXT_INPUT_TYPES = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'image',
  'radio',
  'range',
  'reset',
  'submit'
]);

/** Whether the element accepts text input (and therefore owns clipboard/Delete keys). */
export function isTextEntryElement(el: Element): boolean {
  if (el.closest('.monaco-editor')) return true;
  if (el instanceof HTMLElement && el.isContentEditable) return true;
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  if (el instanceof HTMLInputElement) return !NON_TEXT_INPUT_TYPES.has(el.type);
  return false;
}

/**
 * Whether a keydown with this target should be handled by the file browser
 * shortcuts: either nothing in particular has focus (body/document) or focus
 * is inside the file listing, and the target is not a text field.
 */
export function isStorageShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return true;
  if (target === document.body || target === document.documentElement) return true;
  if (isTextEntryElement(target)) return false;
  return target.closest(`[${STORAGE_SHORTCUT_SCOPE_ATTR}]`) !== null;
}
