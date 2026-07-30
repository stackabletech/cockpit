<script lang="ts">
  import IconBucket from '../shared/BucketIcon.svelte';
  import * as m from '$lib/paraglide/messages.js';
  import { getStorageRouteBase } from '$lib/storage/route-context.js';

  interface Props {
    buckets?: string[];
  }

  let { buckets = [] }: Props = $props();

  const routes = getStorageRouteBase();
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
      <div class="tooltip tooltip-bottom" data-tip={bucket}>
        <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
        <a
          href={routes.storageHref(bucket, '')}
          data-sveltekit-preload-data="off"
          class="
              border-base-300 bg-base-100 hover:border-primary hover:bg-primary/5 flex flex-col items-center
              gap-2 rounded-xl border p-4
              text-center transition-colors
            "
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
