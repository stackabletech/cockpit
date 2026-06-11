<script lang="ts">
  interface Props {
    text: string;
    contentType: string;
  }

  let { text, contentType }: Props = $props();

  // Detect JSON by content type or by trying to parse
  const isJson = $derived(
    contentType === 'application/json' ||
      contentType === 'text/json' ||
      contentType.includes('+json')
  );

  const formatted = $derived.by(() => {
    if (!isJson) return text;
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return text;
    }
  });

  const lines = $derived(formatted.split('\n'));
  const lastLineNumber = $derived(lines.length);

  const language = $derived.by(() => {
    if (isJson) return 'json';
    if (contentType === 'text/css') return 'css';
    if (contentType === 'text/html') return 'html';
    if (contentType === 'text/javascript' || contentType === 'application/javascript')
      return 'javascript';
    if (contentType === 'text/markdown') return 'markdown';
    if (contentType === 'text/csv' || contentType === 'application/csv') return 'text';
    return 'text';
  });
</script>

<div class="bg-base-200/50 flex min-h-full">
  <div
    class="text-base-content/30 p-4 pr-2 pb-4 text-right font-mono text-xs leading-relaxed select-none"
    aria-hidden="true"
  >
    <!-- eslint-disable-next-line @typescript-eslint/no-unused-vars -->
    {#each Array(lastLineNumber) as _n, i (i)}
      {i + 1}<br />
    {/each}
  </div>
  <pre
    class="text-base-content/90 min-h-full flex-1 overflow-x-auto p-4 pl-0 font-mono text-xs leading-relaxed whitespace-pre"
    data-language={language}
    aria-label="File content preview">{formatted}</pre>
</div>
