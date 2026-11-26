import { readStorage, writeStorage } from '$lib/client/local-storage';

/**
 * localStorage key prefix for saved panel widths. The inline script in `src/app.html` reads every
 * key with this prefix before first paint and sets the matching CSS variable, so keep both in sync.
 */
const STORAGE_KEY_PREFIX = 'panel_width:';
const CSS_VAR_PREFIX = '--panel-width-';

interface Options {
  /** Unique panel id (letters, digits, `-`), used for the localStorage key and CSS variable. */
  id: string;
  defaultWidth?: number;
  minWidth?: number;
  maxWidth?: number;
}

/**
 * Creates reactive state and event handlers for a drag-to-resize panel.
 * Call from a component's `<script>` block or another `.svelte.ts` file.
 *
 * Size the panel with `style="width: {panel.cssWidth}"`. It reads the panel's CSS variable, which
 * `src/app.html` restores before first paint, so the saved width applies without a jump on hydration.
 * `width` is the reactive numeric width, e.g. for `aria-valuenow`.
 */
export function createResizablePanel({
  id,
  defaultWidth = 192,
  minWidth = 120,
  maxWidth = 480
}: Options) {
  // Must match the id pattern of the inline script in app.html, or the width is never restored.
  if (!/^[A-Za-z0-9-]+$/.test(id)) throw new Error(`Invalid resizable panel id: ${id}`);
  const storageKey = STORAGE_KEY_PREFIX + id;
  const cssVar = CSS_VAR_PREFIX + id;

  function clamp(w: number): number {
    return Math.min(maxWidth, Math.max(minWidth, w));
  }

  function getInitialWidth(): number {
    const parsed = parseInt(readStorage(storageKey) ?? '', 10);
    return isNaN(parsed) ? defaultWidth : clamp(parsed);
  }

  let width = $state(getInitialWidth());
  let isDragging = $state(false);
  let dragStartX = 0;
  let dragStartWidth = 0;

  function setWidth(w: number) {
    width = clamp(w);
    document.documentElement.style.setProperty(cssVar, `${width}px`);
  }

  // The inline script only accepts positive widths; sync the variable so the rendered width
  // always matches `width` (and `aria-valuenow`), whatever the script did.
  if (typeof window !== 'undefined') setWidth(width);

  function saveWidth() {
    writeStorage(storageKey, String(width));
  }

  function onResizeStart(e: PointerEvent) {
    isDragging = true;
    dragStartX = e.clientX;
    dragStartWidth = width;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  function onResizeMove(e: PointerEvent) {
    if (!isDragging) return;
    setWidth(dragStartWidth + (e.clientX - dragStartX));
  }

  function onResizeEnd() {
    if (!isDragging) return;
    isDragging = false;
    saveWidth();
  }

  function onResizeKeydown(e: KeyboardEvent) {
    const step = e.shiftKey ? 20 : 4;
    if (e.key === 'ArrowRight') {
      setWidth(width + step);
      saveWidth();
      e.preventDefault();
    } else if (e.key === 'ArrowLeft') {
      setWidth(width - step);
      saveWidth();
      e.preventDefault();
    }
  }

  // Keep the col-resize cursor active across the whole page while dragging so
  // it doesn't flicker when the pointer moves faster than the DOM updates. The cleanup also runs
  // when the panel unmounts mid-drag.
  $effect(() => {
    if (!isDragging) return;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  });

  return {
    get width() {
      return width;
    },
    get isDragging() {
      return isDragging;
    },
    /** CSS width that follows the panel's variable, clamped to the panel's limits. */
    cssWidth: `clamp(${minWidth}px, var(${cssVar}, ${defaultWidth}px), ${maxWidth}px)`,
    minWidth,
    maxWidth,
    onResizeStart,
    onResizeMove,
    onResizeEnd,
    onResizeKeydown
  };
}

export type ResizablePanel = ReturnType<typeof createResizablePanel>;
