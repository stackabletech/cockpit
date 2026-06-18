<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { browser } from '$app/environment';
  import { theme } from '$lib/theme.svelte';

  let {
    value = $bindable(),
    contentType = 'text/plain',
    onSave
  }: {
    value?: string;
    contentType?: string;
    onSave?: () => void;
  } = $props();

  let container: HTMLDivElement;
  let editor: import('monaco-editor').editor.IStandaloneCodeEditor | undefined;
  let monaco = $state<typeof import('monaco-editor') | undefined>(undefined);
  let ready = $state(false);

  const language = $derived.by(() => {
    if (
      contentType === 'application/json' ||
      contentType === 'text/json' ||
      contentType.includes('+json')
    )
      return 'json';
    if (contentType === 'text/css') return 'css';
    if (contentType === 'text/html') return 'html';
    if (contentType === 'text/javascript' || contentType === 'application/javascript')
      return 'javascript';
    if (contentType === 'text/markdown') return 'markdown';
    if (contentType === 'application/xml' || contentType === 'text/xml') return 'xml';
    if (contentType === 'application/yaml' || contentType === 'text/yaml') return 'yaml';
    if (contentType === 'text/x-python' || contentType === 'application/x-python') return 'python';
    if (contentType.startsWith('text/')) return 'plaintext';
    return 'plaintext';
  });

  const workerImport = browser ? import('monaco-editor/esm/vs/editor/editor.worker?worker') : null;
  const monacoImport = browser ? import('monaco-editor') : null;

  function toMonacoTheme(t: string): string {
    return t === 'dark' ? 'vs-dark' : 'vs';
  }

  $effect(() => {
    monaco?.editor.setTheme(toMonacoTheme(theme.current));
  });

  onMount(async () => {
    if (!browser) return;

    const EditorWorker = (await workerImport!).default;
    self.MonacoEnvironment = {
      getWorker: () => new EditorWorker()
    };

    monaco = await monacoImport!;

    editor = monaco.editor.create(container, {
      value,
      language,
      theme: toMonacoTheme(theme.current),
      minimap: { enabled: false },
      fontSize: 13,
      lineNumbers: 'on',
      scrollBeyondLastLine: false,
      automaticLayout: true,
      padding: { top: 8, bottom: 8 },
      wordWrap: 'on',
      quickSuggestions: false,
      suggestOnTriggerCharacters: false,
      renderWhitespace: 'boundary',
      bracketPairColorization: { enabled: true }
    });

    editor.focus();

    editor.onDidChangeModelContent(() => {
      value = editor!.getValue();
    });

    if (onSave) {
      editor.addAction({
        id: 'save-file',
        label: 'Save File',
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
        run: onSave
      });
    }

    ready = true;
  });

  onDestroy(() => {
    editor?.dispose();
  });
</script>

<div
  bind:this={container}
  class="h-full min-h-0 w-full"
  class:opacity-0={!ready}
  data-ready={ready || undefined}
  role="application"
  aria-label="Text editor"
>
  {#if !browser || !ready}
    <pre
      class="text-base-content/90 bg-base-200/50 h-full overflow-auto p-4 font-mono text-xs whitespace-pre-wrap">{value}</pre>
  {/if}
</div>
