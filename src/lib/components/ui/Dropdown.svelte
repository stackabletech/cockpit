<script lang="ts" module>
  import type { Attachment } from 'svelte/attachments';

  /**
   * Spread onto the trigger button: `<button {...trigger} ...>`. Its `style` holds the anchor name,
   * so the button must not set a `style` of its own.
   */
  export interface DropdownTrigger {
    popovertarget: string;
    'aria-expanded': boolean;
    'aria-controls': string;
    'aria-haspopup': 'menu' | 'dialog';
    style: string;
    [key: symbol]: Attachment<HTMLElement>;
  }
</script>

<script lang="ts">
  import { tick, type Snippet } from 'svelte';
  import { createAttachmentKey } from 'svelte/attachments';
  import { supportsAnchorPositioning, trackPopover } from './popover-position.js';

  interface Props {
    /** Whether the panel is open; set it to false to close the panel, e.g. after an action. */
    open?: boolean;
    /** Which edge of the trigger the panel lines up with. */
    align?: 'start' | 'end';
    /** `menu` for a list of actions, `dialog` for any other content. */
    popup?: 'menu' | 'dialog';
    /** Accessible name of a `dialog` panel. */
    label?: string;
    /** Classes for the panel, e.g. its width. */
    class?: string;
    /** Leaves out the default surface (background, border, shadow) for a panel styled by `class`. */
    bare?: boolean;
    /** The trigger button, which gets its attributes from the snippet's argument. */
    trigger: Snippet<[DropdownTrigger]>;
    /** The panel's content, only rendered while it is open. */
    children: Snippet;
    /** Called once the content has been rendered after opening, e.g. to move the focus. */
    onopen?: (panel: HTMLElement) => void;
  }

  let {
    open = $bindable(false),
    align = 'start',
    popup = 'menu',
    label,
    class: className = '',
    bare = false,
    trigger,
    children,
    onopen
  }: Props = $props();

  const uid = $props.id();
  const panelId = `${uid}-dropdown`;
  const anchor = `--${uid}-dropdown-anchor`;

  let triggerEl = $state<HTMLElement>();
  let panelEl = $state<HTMLElement>();
  // Follows the popover itself: the content renders as the popover opens, so it never shows empty,
  // and is removed only once it has closed and faded out.
  let shown = $state(false);
  let returnFocus = false;

  const triggerProps = $derived<DropdownTrigger>({
    popovertarget: panelId,
    'aria-expanded': open,
    'aria-controls': panelId,
    'aria-haspopup': popup,
    style: `anchor-name: ${anchor}`,
    [createAttachmentKey()]: (el: HTMLElement) => {
      triggerEl = el;
    }
  });

  // Keeps the popover in line with `open` when the caller changes it.
  $effect(() => {
    const el = panelEl;
    if (!el) return;
    if (open !== el.matches(':popover-open')) el.togglePopover(open);
  });

  // Without CSS anchor positioning the popover would sit in the middle of the viewport.
  $effect(() => {
    if (open && triggerEl && panelEl && !supportsAnchorPositioning())
      return trackPopover(triggerEl, panelEl, { align });
  });

  function handleBeforeToggle(e: ToggleEvent) {
    // Synchronous, unlike `toggle`: the content is there by the time the popover shows.
    if (e.newState === 'open') open = shown = true;
    // Hiding drops the focus to <body> when it is inside the panel; give it back to the trigger.
    else returnFocus = !!panelEl?.contains(document.activeElement);
  }

  async function handleToggle(e: ToggleEvent) {
    open = e.newState === 'open';
    if (open) {
      shown = true;
      await tick();
      if (panelEl) onopen?.(panelEl);
      return;
    }
    if (returnFocus) {
      returnFocus = false;
      // Only when the focus was lost, not when it has moved on meanwhile.
      if (!document.activeElement || document.activeElement === document.body) triggerEl?.focus();
    }
    // DaisyUI fades the panel out after it has closed; removing the content earlier would leave
    // an empty panel fading out.
    await Promise.allSettled(panelEl?.getAnimations().map((animation) => animation.finished) ?? []);
    if (!open) shown = false;
  }

  /**
   * Closes when the focus moves on to something outside the panel, e.g. with Tab, as in the
   * WAI-ARIA menu button pattern; popovers only close on clicks and Escape by themselves.
   */
  function handleFocusOut(e: FocusEvent) {
    const next = e.relatedTarget as Node | null;
    if (next && !panelEl?.contains(next) && next !== triggerEl) open = false;
  }
</script>

{@render trigger(triggerProps)}

<!--
  An auto popover sits in the browser's top layer, above every z-index and open modals, and the
  browser closes it on an outside click, on Escape and when another popover opens. A display class
  on the popover itself would override the browser's `display: none` for a closed popover, so the
  content gets its own wrapper where it needs one.
-->
<div
  bind:this={panelEl}
  id={panelId}
  popover="auto"
  class="
    dropdown my-1 backdrop:bg-transparent
    {bare ? '' : 'border-base-300 bg-base-100 text-base-content rounded-box border shadow-lg'}
    {align === 'end' ? 'dropdown-end' : ''}
    {className}
  "
  style="position-anchor: {anchor}; position-try-fallbacks: flip-block, flip-inline;"
  role={popup === 'dialog' ? 'dialog' : undefined}
  aria-label={popup === 'dialog' ? label : undefined}
  onbeforetoggle={handleBeforeToggle}
  ontoggle={handleToggle}
  onfocusout={handleFocusOut}
  oncontextmenu={(e) => e.preventDefault()}
>
  <!--
    DaisyUI's `.dropdown:focus-within > [tabindex]:first-child` turns off pointer events for the
    first child with a tabindex, e.g. a focusable menu list; the wrapper keeps it clickable.
  -->
  <div>
    {#if shown}
      {@render children()}
    {/if}
  </div>
</div>
