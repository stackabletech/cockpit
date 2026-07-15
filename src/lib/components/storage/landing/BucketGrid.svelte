<script lang="ts">
  import IconBucket from '../shared/BucketIcon.svelte';
  import Tooltip from '$lib/components/Tooltip.svelte';
  import * as m from '$lib/paraglide/messages.js';
  import { resolve } from '$app/paths';

  interface Props {
    buckets?: string[];
  }

  let { buckets = [] }: Props = $props();

  let tooltipText = $state<string | null>(null);
  let tooltipX = $state(0);
  let tooltipY = $state(0);
</script>

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
        onmouseenter={(e) => {
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
          tooltipText = bucket;
          tooltipX = rect.left + rect.width / 2;
          tooltipY = rect.bottom;
        }}
        onmouseleave={() => {
          tooltipText = null;
        }}
      >
        <IconBucket class="text-warning size-10" aria-hidden="true" />
        <span class="w-full truncate text-sm font-medium">{bucket}</span>
      </a>
    {/each}
  </div>
  <Tooltip text={tooltipText} x={tooltipX} y={tooltipY} orientation="down" />
{:else}
  <p class="text-base-content/50 text-sm">{m.storage_buckets_empty()}</p>
{/if}
