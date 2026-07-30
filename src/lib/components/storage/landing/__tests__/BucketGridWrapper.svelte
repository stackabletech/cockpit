<script lang="ts">
  import { untrack } from 'svelte';
  import { setStorageRouteBase, APP_STORAGE_ROUTES } from '$lib/storage/route-context.js';
  import BucketGrid from '../BucketGrid.svelte';

  interface Props {
    buckets?: string[];
  }

  let { buckets = [] }: Props = $props();
  untrack(() => setStorageRouteBase(APP_STORAGE_ROUTES));
</script>

<BucketGrid {buckets} />
