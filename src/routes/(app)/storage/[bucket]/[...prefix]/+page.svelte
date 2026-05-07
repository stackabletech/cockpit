<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import FileExplorer from '$lib/components/storage/FileExplorer.svelte';

  let { data } = $props();

  function handleNavigate(
    prefix: string,
    continuationToken: string | null = null,
    pageSize: number | null = null
  ) {
    const encodedPrefix = prefix
      ? prefix.replace(/\/$/, '').split('/').map(encodeURIComponent).join('/')
      : '';

    const target = resolve('/(app)/storage/[bucket]/[...prefix]', {
      bucket: encodeURIComponent(data.bucket),
      prefix: encodedPrefix
    });

    const params = new URLSearchParams();
    if (continuationToken) params.set('continuationToken', String(continuationToken));
    if (pageSize) params.set('pageSize', String(pageSize));

    const url = params.toString() ? `${target}?${params.toString()}` : target;
    goto(url, { replaceState: false });
  }
</script>

<FileExplorer
  bucket={data.bucket}
  objects={data.objects}
  prefix={data.prefix}
  onnavigate={handleNavigate}
/>
