<script lang="ts">
  import IconBucket from '../shared/BucketIcon.svelte';
  import IconInfo from 'virtual:icons/material-symbols/info';
  import * as m from '$lib/paraglide/messages.js';
  import { resolve } from '$app/paths';
  import { getStorageState } from '$lib/storage/context.js';
  import FloatingMenu from '../shared/FloatingMenu.svelte';

  interface Props {
    buckets?: string[];
  }

  let { buckets = [] }: Props = $props();
  const storage = getStorageState();

  let ctxMenu = $state<{ x: number; y: number; bucket: string } | null>(null);

  function openDetails(bucket: string) {
    storage.openModal('details', { type: 'bucket', bucket });
    ctxMenu = null;
  }

  function handleContextMenu(e: MouseEvent, bucket: string) {
    e.preventDefault();
    ctxMenu = { x: e.clientX, y: e.clientY, bucket };
  }

  function closeContextMenu() {
    ctxMenu = null;
  }
</script>

<FloatingMenu
  x={ctxMenu?.x ?? 0}
  y={ctxMenu?.y ?? 0}
  open={ctxMenu !== null}
  onclose={closeContextMenu}
>
  <button
    role="menuitem"
    class="btn btn-ghost btn-sm w-full justify-start gap-2"
    onclick={() => ctxMenu && openDetails(ctxMenu.bucket)}
  >
    <IconInfo class="size-4" aria-hidden="true" />
    {m.storage_action_details()}
  </button>
</FloatingMenu>

{#if buckets.length > 0}
  <div
    class="
      grid grid-cols-2 gap-3
      sm:grid-cols-3
      md:grid-cols-4
      lg:grid-cols-6
    "
  >
    {#each buckets as bucket (bucket)}
      <div class="tooltip tooltip-bottom" data-tip={bucket}>
        <a
          href={resolve('/(app)/storage/[bucket]/[...prefix]', {
            bucket: encodeURIComponent(bucket),
            prefix: ''
          })}
          data-sveltekit-preload-data="off"
          class="
              border-base-300 bg-base-100 hover:border-primary hover:bg-primary/5 flex flex-col items-center
              gap-2 rounded-xl border p-4
              text-center transition-colors
            "
          oncontextmenu={(e) => handleContextMenu(e, bucket)}
        >
          <IconBucket class="text-warning size-10" aria-hidden="true" />
          <span class="w-full truncate text-sm font-medium">{bucket}</span>
        </a>
      </div>
    {/each}
  </div>
{:else}
  <p class="text-base-content/50 text-sm">{m.storage_buckets_empty()}</p>
{/if}
