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

    const parts: string[] = [];
    if (continuationToken)
      parts.push(`continuationToken=${encodeURIComponent(String(continuationToken))}`);
    if (pageSize) parts.push(`pageSize=${encodeURIComponent(String(pageSize))}`);

    const query = parts.length ? `?${parts.join('&')}` : '';
    goto(
      resolve('/(app)/storage/[bucket]/[...prefix]', {
        bucket: encodeURIComponent(data.bucket),
        prefix: encodedPrefix
      }) + query,
      { replaceState: false }
    );
  }
</script>

<FileExplorer
  bucket={data.bucket}
  objects={data.objects}
  prefix={data.prefix}
  onNavigate={handleNavigate}
/>
