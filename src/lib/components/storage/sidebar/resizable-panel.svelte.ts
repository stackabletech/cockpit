import { browser } from '$app/environment';

interface Options {
  storageKey: string;
  defaultWidth?: number;
  minWidth?: number;
  maxWidth?: number;
}

/**
 * Creates reactive state and event handlers for a drag-to-resize sidebar panel.
 * Call from a component's `<script>` block or another `.svelte.ts` file.
 * The returned object's `width` is reactive and can be used directly in
 * `style="width: {resize.width}px"`.
 */
export function createResizablePanel({
  storageKey,
  defaultWidth = 192,
  minWidth = 120,
  maxWidth = 480
}: Options) {
  function getInitialWidth(): number {
    if (!browser) return defaultWidth;
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const parsed = parseInt(stored, 10);
        if (!isNaN(parsed) && parsed >= minWidth && parsed <= maxWidth) return parsed;
      }
    } catch {
      /* ignore storage errors */
    }
    return defaultWidth;
  }

  function saveWidth(w: number) {
    try {
      localStorage.setItem(storageKey, String(w));
      document.documentElement.style.setProperty('--storage-sidebar-width', w + 'px');
    } catch {
      /* ignore storage errors */
    }
  }

  let width = $state(getInitialWidth());
  let isDragging = $state(false);
  let dragStartX = 0;
  let dragStartWidth = 0;

  function onResizeStart(e: PointerEvent) {
    isDragging = true;
    dragStartX = e.clientX;
    dragStartWidth = width;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  function onResizeMove(e: PointerEvent) {
    if (!isDragging) return;
    width = Math.min(maxWidth, Math.max(minWidth, dragStartWidth + (e.clientX - dragStartX)));
  }

  function onResizeEnd() {
    if (!isDragging) return;
    isDragging = false;
    saveWidth(width);
  }

  function onResizeKeydown(e: KeyboardEvent) {
    const step = e.shiftKey ? 20 : 4;
    if (e.key === 'ArrowRight') {
      width = Math.min(maxWidth, width + step);
      saveWidth(width);
      e.preventDefault();
    } else if (e.key === 'ArrowLeft') {
      width = Math.max(minWidth, width - step);
      saveWidth(width);
      e.preventDefault();
    }
  }

  // Keep the col-resize cursor active across the whole page while dragging so
  // it doesn't flicker when the pointer moves faster than the DOM updates.
  $effect(() => {
    if (!browser) return;
    if (isDragging) {
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    } else {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
  });

  return {
    get width() {
      return width;
    },
    get isDragging() {
      return isDragging;
    },
    minWidth,
    maxWidth,
    onResizeStart,
    onResizeMove,
    onResizeEnd,
    onResizeKeydown
  };
}

export type ResizablePanel = ReturnType<typeof createResizablePanel>;
