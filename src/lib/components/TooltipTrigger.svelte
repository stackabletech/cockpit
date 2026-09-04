<script lang="ts">
  import { mount, unmount, untrack } from 'svelte';
  import type { Snippet } from 'svelte';
  import Tooltip from './Tooltip.svelte';

  export type TooltipOrientation = 'right' | 'left' | 'up' | 'down';

  interface Props {
    text: string | null;
    children: Snippet;
    orientation?: TooltipOrientation;
  }
  let { text, children, orientation = 'right' }: Props = $props();

  // The wrapper uses `display: contents` so it never interferes with the
  // layout of the trigger (flex items, table cells, etc.). It only exists to
  // observe hover/focus on the trigger and to position the popup.
  let trigger = $state<HTMLElement | null>(null);
  let visible = $state(false);
  let x = $state(0);
  let y = $state(0);

  function show() {
    if (!trigger) return;
    const el = (trigger.firstElementChild ?? trigger) as HTMLElement | null;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (orientation === 'right') {
      x = rect.right;
      y = rect.top + rect.height / 2;
    } else if (orientation === 'left') {
      x = rect.left;
      y = rect.top + rect.height / 2;
    } else if (orientation === 'up') {
      x = rect.left + rect.width / 2;
      y = rect.top;
    } else {
      x = rect.left + rect.width / 2;
      y = rect.bottom;
    }
    portalTarget = findPortalTarget();
    visible = true;
  }

  function hide() {
    visible = false;
  }

  // ── Portal ──────────────────────────────────────────────────────────────
  // The popup is rendered into a portal instead of inline because a popup
  // rendered inside the trigger's subtree can be trapped by its ancestors:
  //  - a `transform`/`translate`/`scale`/`filter` ancestor (e.g. daisyUI's
  //    `.modal-box`) becomes the containing block for `position: fixed`
  //    descendants, which offsets the popup and clips it inside the parent;
  //  - a low z-index ancestor (e.g. the sidebar, which sits below the main
  //    content) lets sibling content cover the popup no matter how high the
  //    popup's own z-index is.
  // When the trigger lives inside a <dialog> (rendered in the browser's top
  // layer), the portal is attached to that dialog so the popup stays above
  // the modal content; otherwise it is attached to <body> with a z-index
  // above all app content.
  type TooltipState = {
    text: string | null;
    x: number;
    y: number;
    orientation: TooltipOrientation;
  };
  let portalTarget: HTMLElement | undefined;
  let portalHost: HTMLDivElement | undefined;
  let tooltipState: TooltipState | undefined;

  function findPortalTarget(): HTMLElement {
    let el: HTMLElement | null = trigger;
    while (el && el.tagName !== 'DIALOG') {
      el = el.parentElement;
    }
    return (el ?? document.body) as HTMLElement;
  }

  $effect(() => {
    if (!visible) return;
    portalHost = document.createElement('div');
    portalHost.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:10000;';
    portalTarget?.appendChild(portalHost);
    const state = mount(Tooltip, {
      target: portalHost,
      props: untrack(() => ({ text, x, y, orientation }))
    }) as TooltipState;
    tooltipState = state;

    return () => {
      unmount(state);
      portalHost?.remove();
      portalHost = undefined;
      tooltipState = undefined;
    };
  });

  $effect(() => {
    if (!visible || !tooltipState) return;
    tooltipState.text = text;
    tooltipState.x = x;
    tooltipState.y = y;
    tooltipState.orientation = orientation;
  });
</script>

<span
  class="contents"
  role="presentation"
  bind:this={trigger}
  onmouseenter={show}
  onmouseleave={hide}
  onfocusin={show}
  onfocusout={hide}
>
  {@render children()}
</span>
