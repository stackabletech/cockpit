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

  // Portal action: moves the element to document.body so it escapes any
  // ancestor overflow/transform constraints (e.g. inside <dialog> or modal-box).
  function portal(node: HTMLElement) {
    if (typeof document === 'undefined') return {};
    document.body.appendChild(node);
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
