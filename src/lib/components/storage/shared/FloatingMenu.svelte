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
</script>

{#if open}
  <div
    role="presentation"
    class="fixed inset-0 z-40"
    onclick={onclose}
    oncontextmenu={(e) => {
      e.preventDefault();
      onclose();
    }}
  ></div>
  <div
    class="border-base-300 bg-base-100 fixed z-50 w-48 rounded-lg border p-1 shadow-lg"
    style="left: {x}px; top: {y}px;"
    role="menu"
  >
    {@render children()}
  </div>
{/if}
