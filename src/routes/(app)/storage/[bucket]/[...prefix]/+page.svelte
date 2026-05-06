<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import FileExplorer from '$lib/components/storage/FileExplorer.svelte';

  let { data } = $props();

  function handleNavigate(prefix: string) {
    const encodedPrefix = prefix
      ? prefix.replace(/\/$/, '').split('/').map(encodeURIComponent).join('/')
      : '';
    goto(
      resolve('/(app)/storage/[bucket]/[...prefix]', {
        bucket: encodeURIComponent(data.bucket),
        prefix: encodedPrefix
      }),
      { replaceState: false }
    );
  }
</script>

<FileExplorer
  bucket={data.bucket}
  objects={data.objects}
  prefix={data.prefix}
  onnavigate={handleNavigate}
/>
