<script lang="ts">
  import IconBucket from '../shared/BucketIcon.svelte';
  import IconInfo from 'virtual:icons/material-symbols/info';
  import * as m from '$lib/paraglide/messages.js';
  import { resolve } from '$app/paths';
  import { getStorageState } from '$lib/storage/context.js';

  interface Props {
    buckets?: string[];
  }

  let { buckets = [] }: Props = $props();
  const storage = getStorageState();

  let ctxBucket = $state<string | null>(null);
  let ctxX = $state(0);
  let ctxY = $state(0);

  function openDetails(bucket: string) {
    storage.openModal('details', { type: 'bucket', bucket });
    ctxBucket = null;
  }

  function handleContextMenu(e: MouseEvent, bucket: string) {
    e.preventDefault();
    ctxBucket = bucket;
    ctxX = e.clientX;
    ctxY = e.clientY;
  }

  function closeContextMenu() {
    ctxBucket = null;
  }
</script>

{#if ctxBucket}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-70"
    onclick={closeContextMenu}
    oncontextmenu={(e) => e.preventDefault()}
  ></div>
  <div
    class="
      border-base-300 bg-base-100 fixed z-80 w-48 rounded-lg
      border p-1 shadow-lg
    "
    style="left: {ctxX}px; top: {ctxY}px;"
  >
    <button
      class="btn btn-ghost btn-sm w-full justify-start gap-2"
      onclick={() => openDetails(ctxBucket!)}
    >
      <IconInfo class="size-4" aria-hidden="true" />
      {m.storage_action_details()}
    </button>
  </div>
{/if}

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
