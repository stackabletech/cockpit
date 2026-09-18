<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    x: number;
    y: number;
    open: boolean;
    onclose: () => void;
    children: Snippet;
  }

  let { x, y, open, onclose, children }: Props = $props();

  // Portal action: moves the element into the currently open <dialog> so it
  // stays within the browser's top layer (which renders above the modal
  // backdrop). Falling back to document.body for non-dialog usage.
  function portal(node: HTMLElement) {
    if (typeof document === 'undefined') return {};
    const target = document.querySelector('dialog[open]') ?? document.body;
    target.appendChild(node);
    return {
      destroy() {
        try {
          node.remove();
        } catch {
          // already removed
        }
      }
    };
  }
</script>

{#if open}
  <div
    use:portal
    role="presentation"
    class="fixed inset-0 z-9998"
    onclick={onclose}
    oncontextmenu={(e) => {
      e.preventDefault();
      onclose();
    }}
  ></div>
  <div
    use:portal
    class="border-base-300 bg-base-100 fixed z-9999 w-48 rounded-lg border p-1 shadow-lg"
    style="left: {x}px; top: {y}px;"
    role="menu"
  >
    {@render children()}
  </div>
{/if}
