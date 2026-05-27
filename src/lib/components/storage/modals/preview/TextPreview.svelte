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

<pre
  class="text-base-content/90 bg-base-200/50 min-h-full p-4 font-mono text-xs leading-relaxed whitespace-pre"
  data-language={language}
  aria-label="File content preview">{formatted}</pre>
