<script lang="ts">
  import { page } from '$app/state';
  import Icon from '@iconify/svelte';
  import * as m from '$lib/paraglide/messages.js';

  interface Props {
    buckets: string[];
  }

  let { buckets }: Props = $props();

  const activeBucket = $derived(page.params.bucket ?? null);
</script>

<nav
  class="
    border-base-300 bg-base-100 flex w-48 shrink-0 flex-col
    rounded-lg border
  "
  aria-label={m.storage_buckets_label()}
>
  <div
    class="
      border-base-300 flex items-center justify-between border-b px-3 py-2
    "
  >
    <span
      class="
        text-base-content/50 text-xs font-semibold tracking-wide uppercase
      "
    >
      {m.storage_buckets_label()}
    </span>
    <a
      href="/storage"
      data-sveltekit-preload-data="off"
      class="btn btn-ghost btn-xs"
      title={m.storage_view_all_buckets()}
      aria-label={m.storage_view_all_buckets()}
    >
      <Icon icon="material-symbols:grid-view" class="size-3.5" aria-hidden="true" />
    </a>
  </div>

  <ul class="flex-1 py-1" role="list">
    {#if buckets.length === 0}
      <li class="text-base-content/40 px-3 py-4 text-center text-xs">
        {m.storage_buckets_empty()}
      </li>
    {:else}
      {#each buckets as bucket (bucket)}
        <li role="none">
          <a
            href="/storage/{encodeURIComponent(bucket)}"
            data-sveltekit-preload-data="off"
            class="
              hover:bg-base-200 tooltip tooltip-right flex items-center gap-2
              px-3 py-1.5 text-sm
              {activeBucket === bucket
              ? 'bg-primary/10 text-primary font-medium'
              : 'text-base-content'}"
            data-tip={bucket}
            aria-current={activeBucket === bucket ? 'page' : undefined}
          >
            <Icon
              icon="mdi:bucket-outline"
              class="size-3.5 shrink-0 opacity-60"
              aria-hidden="true"
            />
            <span class="truncate">{bucket}</span>
          </a>
        </li>
      {/each}
    {/if}
  </ul>

  <!-- TODO: This needs to be a two step process to avoid unintentional disconnects from misclicks -->
  <!-- Disconnect button -->
  <div class="border-base-300 border-t p-2">
    <form method="POST" action="/storage?/disconnect">
      <button
        type="submit"
        class="
        btn text-base-content/60 btn-ghost btn-xs hover:text-error w-full
      "
      >
        {m.storage_disconnect()}
      </button>
    </form>
  </div>
</nav>
