<script lang="ts" module>
  // A right-click fires `contextmenu` on mousedown on Linux and macOS (and a touch long-press while
  // the finger is still down). The browser's light dismiss on the following pointerup would close a
  // menu opened in between straight away, so such a menu waits for the release.
  let pointerPressed = false;
  if (typeof window !== 'undefined') {
    window.addEventListener('pointerdown', () => (pointerPressed = true), true);
    for (const type of ['pointerup', 'pointercancel', 'dragend'])
      window.addEventListener(type, () => (pointerPressed = false), true);
    // Leaving the window may end a press without a pointerup. Without capture, so that elements
    // losing focus (their blur does not bubble) do not count.
    window.addEventListener('blur', () => (pointerPressed = false));
  }

  function afterPointerRelease(callback: () => void): () => void {
    if (!pointerPressed) {
      callback();
      return () => {};
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const release = () => {
      remove();
      // Run after the pointerup has been dispatched, and with it the light dismiss.
      timer = setTimeout(callback);
    };
    const remove = () => {
      window.removeEventListener('pointerup', release, true);
      window.removeEventListener('pointercancel', release, true);
    };
    window.addEventListener('pointerup', release, true);
    window.addEventListener('pointercancel', release, true);
    return () => {
      remove();
      clearTimeout(timer);
    };
  }
</script>

<script lang="ts">
  import { untrack } from 'svelte';
  import IconClose from 'virtual:icons/material-symbols/close';
  import * as m from '$lib/paraglide/messages.js';
  import MenuItems, { type MenuAction } from './MenuItems.svelte';

  interface Props {
    open: boolean;
    /** Viewport coordinates of the menu's corner, e.g. from a `contextmenu` event. */
    x: number;
    y: number;
    actions: MenuAction[];
    onaction: (key: string) => void;
    /** Called whenever the menu closes: after an action, or when the browser dismisses it. */
    onclose: () => void;
    title?: string;
  }

  let { open, x, y, actions, onaction, onclose, title }: Props = $props();

  let popoverEl = $state<HTMLDivElement>();
  // Set while the menu hides itself to move, so that hiding does not count as closing.
  let moving = false;

  // An auto popover sits in the browser's top layer, above every z-index and open modals, and
  // the browser closes it on an outside click, on Escape and when another popover opens.
  $effect(() => {
    const el = popoverEl;
    if (!el) return;
    if (!open) {
      if (el.matches(':popover-open')) el.hidePopover();
      return;
    }
    return afterPointerRelease(() => show(el));
  });

  // A new point while the menu is open, e.g. a right-click on another file of the same list.
  $effect(() => {
    const el = popoverEl;
    const point = { x, y };
    if (!open || !el || !untrack(() => el.matches(':popover-open'))) return;
    if (!pointerPressed) {
      place(el, point.x, point.y);
      return;
    }
    // The release of that right-click would light-dismiss the menu, so it hides until then.
    moving = true;
    el.hidePopover();
    moving = false;
    return afterPointerRelease(() => show(el));
  });

  function show(el: HTMLElement) {
    if (el.matches(':popover-open')) return;
    el.showPopover();
    place(
      el,
      untrack(() => x),
      untrack(() => y)
    );
    el.querySelector<HTMLElement>('[role="menu"]')?.focus();
  }

  /** Puts the menu at (x, y), flipped to the other side where it would leave the viewport. */
  function place(el: HTMLElement, x: number, y: number) {
    const { width, height } = el.getBoundingClientRect();
    const left = x + width > window.innerWidth ? x - width : x;
    const top = y + height > window.innerHeight ? y - height : y;
    el.style.left = `${Math.max(0, left)}px`;
    el.style.top = `${Math.max(0, top)}px`;
  }

  function close() {
    if (open) onclose();
  }

  function handleBeforeToggle(e: ToggleEvent) {
    if (e.newState === 'closed' && !moving) close();
  }

  function run(key: string) {
    onaction(key);
    close();
  }
</script>

<!--
  The popover is a wrapper: a display class such as DaisyUI's `menu` on the popover itself would
  override the browser's `display: none` for a closed popover.
-->
<div
  bind:this={popoverEl}
  popover="auto"
  class="border-base-300 bg-base-100 text-base-content w-48 rounded-lg border p-1 shadow-lg"
  style="inset: auto; margin: 0;"
  role="presentation"
  onbeforetoggle={handleBeforeToggle}
  oncontextmenu={(e) => e.preventDefault()}
>
  {#if title}
    <!--
      Outside the menu, so the arrow keys skip the close button. It is no Tab stop either: from the
      keyboard the menu closes with Escape.
    -->
    <div class="flex items-center justify-between py-1 pr-0 pl-2">
      <span class="text-base-content/70 text-xs font-medium">{title}</span>
      <div class="tooltip tooltip-left" data-tip={m.action_close()}>
        <button
          type="button"
          tabindex="-1"
          class="btn btn-ghost btn-xs"
          aria-label={m.action_close()}
          onclick={close}
        >
          <IconClose class="size-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  {/if}
  <MenuItems {actions} onselect={run} label={title} />
</div>
