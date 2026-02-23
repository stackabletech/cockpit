<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { browser } from '$app/environment';

  let {
    value = $bindable(),
    language = 'sql',
    onExecute
  }: {
    value?: string;
    language?: string;
    onExecute?: () => void;
  } = $props();

  let container: HTMLDivElement;
  let editor: import('monaco-editor').editor.IStandaloneCodeEditor | undefined;
  let monaco: typeof import('monaco-editor') | undefined;
  let observer: MutationObserver | undefined;

  // Start loading in parallel with the rest of the page — not deferred to onMount.
  // Guarded by `browser` because SvelteKit evaluates component scripts on the server too.
  const workerImport = browser
    ? import('monaco-editor/esm/vs/editor/editor.worker?worker')
    : null;
  const monacoImport = browser ? import('monaco-editor') : null;

  // Detect current theme from DaisyUI data-theme attribute
  function getMonacoTheme(): string {
    if (!browser) return 'vs-dark';
    return document.documentElement.dataset.theme === 'dark' ? 'vs-dark' : 'vs';
  }

  onMount(async () => {
    // By the time onMount fires the imports are likely already resolved.
    const EditorWorker = (await workerImport!).default;
    self.MonacoEnvironment = {
      getWorker: () => new EditorWorker()
    };

    monaco = await monacoImport!;

    editor = monaco.editor.create(container, {
      value,
      language,
      theme: getMonacoTheme(),
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

    if (onExecute) {
      editor.addAction({
        id: 'execute-query',
        label: 'Execute Query',
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
        run: onExecute
      });
    }

    // Watch for theme changes
    observer = new MutationObserver(() => {
      monaco?.editor.setTheme(getMonacoTheme());
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme']
    });
  });

  onDestroy(() => {
    observer?.disconnect();
    editor?.dispose();
  });
</script>

<div bind:this={container} class="h-full w-full"></div>
