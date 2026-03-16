<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { browser } from '$app/environment';
  import { theme } from '$lib/theme.svelte';
  import { registerTrinoSql, TRINO_SQL_LANGUAGE_ID } from '$lib/editor/trinosql';

  let {
    value = $bindable(),
    language = TRINO_SQL_LANGUAGE_ID,
    onExecute
  }: {
    value?: string;
    language?: string;
    onExecute?: () => void;
  } = $props();

  let container: HTMLDivElement;
  let editor: import('monaco-editor').editor.IStandaloneCodeEditor | undefined;
  let monaco = $state<typeof import('monaco-editor') | undefined>(undefined);
  let ready = $state(false);

  export function insertAtCursor(text: string) {
    if (!editor || !monaco) return;
    // Focus first so getSelection() returns a valid position (needed for Firefox).
    editor.focus();
    const selection = editor.getSelection() ?? new monaco.Selection(1, 1, 1, 1);
    editor.executeEdits('catalog-browser', [{ range: selection, text, forceMoveMarkers: true }]);
  }

  // Start loading in parallel with the rest of the page — not deferred to onMount.
  // Guarded by `browser` because SvelteKit evaluates component scripts on the server too.
  const workerImport = browser ? import('monaco-editor/esm/vs/editor/editor.worker?worker') : null;
  const monacoImport = browser ? import('monaco-editor') : null;

  function toMonacoTheme(t: string): string {
    return t === 'dark' ? 'vs-dark' : 'vs';
  }

  $effect(() => {
    monaco?.editor.setTheme(toMonacoTheme(theme.current));
  });

  onMount(async () => {
    // By the time onMount fires the imports are likely already resolved.
    const EditorWorker = (await workerImport!).default;
    self.MonacoEnvironment = {
      getWorker: () => new EditorWorker()
    };

    monaco = await monacoImport!;

    registerTrinoSql(monaco);

    editor = monaco.editor.create(container, {
      value,
      language,
      theme: toMonacoTheme(theme.current),
      minimap: { enabled: false },
      fontSize: 14,
      lineNumbers: 'on',
      scrollBeyondLastLine: false,
      automaticLayout: true,
      padding: { top: 12, bottom: 12 },
      wordWrap: 'on'
    });

    editor.onDidChangeModelContent(() => {
      value = editor!.getValue();
    });

    ready = true;

    if (onExecute) {
      editor.addAction({
        id: 'execute-query',
        label: 'Execute Query',
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
        run: onExecute
      });
    }
  });

  onDestroy(() => {
    editor?.dispose();
  });
</script>

<div bind:this={container} class="h-full w-full" data-ready={ready || undefined}></div>
