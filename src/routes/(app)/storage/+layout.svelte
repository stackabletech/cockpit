<script lang="ts">
  import BucketList from '$lib/components/storage/BucketList.svelte';

  let { children, data } = $props();
</script>

{#if data.connected}
  <div class="flex h-full min-h-0 gap-4">
    <BucketList buckets={data.buckets} />
    <div class="flex min-w-0 flex-1 flex-col">
      {@render children()}
    </div>
  </div>
{:else}
  {@render children()}
{/if}
