<script lang="ts">
  import Icon from '@iconify/svelte';
  import { navigating } from '$app/state';
  import * as m from '$lib/paraglide/messages.js';

  interface Props {
    buckets?: string[];
  }

  let { buckets = [] }: Props = $props();
</script>

{#if buckets.length > 0}
  <div class="relative">
    {#if navigating?.to?.url.pathname.startsWith('/storage/')}
      <div
        class="bg-base-100/70 absolute inset-0 z-10 flex items-center justify-center rounded-xl"
        aria-live="polite"
        aria-label={m.storage_loading()}
      >
        <span class="loading loading-md loading-spinner text-primary" aria-hidden="true"></span>
      </div>
    {/if}
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
            href="/storage/{encodeURIComponent(bucket)}"
            data-sveltekit-preload-data="off"
            class="
              border-base-300 bg-base-100 hover:border-primary hover:bg-primary/5 flex flex-col items-center
              gap-2 rounded-xl border p-4
              text-center transition-colors
            "
          >
            <Icon icon="mdi:bucket-outline" class="text-warning size-10" aria-hidden="true" />
            <span class="w-full truncate text-sm font-medium">{bucket}</span>
          </a>
        </div>
      {/each}
    </div>
  </div>
{:else}
  <p class="text-base-content/50 text-sm">{m.storage_buckets_empty()}</p>
{/if}
