<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { browser } from '$app/environment';
  import { theme } from '$lib/theme.svelte';
  import { getLocale } from '$lib/paraglide/runtime.js';

  let {
    value = $bindable(),
    contentType = 'text/plain',
    filename = '',
    readonly = false,
    ready = $bindable(false),
    onSave
  }: {
    value?: string;
    contentType?: string;
    filename?: string;
    readonly?: boolean;
    ready?: boolean;
    onSave?: () => void;
  } = $props();

  let container: HTMLDivElement;
  let editor: import('monaco-editor').editor.IStandaloneCodeEditor | undefined;
  let monaco = $state<typeof import('monaco-editor') | undefined>(undefined);

  const extension = $derived(filename.split('.').pop()?.toLowerCase() ?? '');

  const extLanguageMap: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    json: 'json',
    jsonc: 'json',
    html: 'html',
    htm: 'html',
    css: 'css',
    scss: 'scss',
    less: 'less',
    md: 'markdown',
    mdx: 'markdown',
    xml: 'xml',
    svg: 'xml',
    yaml: 'yaml',
    yml: 'yaml',
    py: 'python',
    pyw: 'python',
    rb: 'ruby',
    rs: 'rust',
    go: 'go',
    java: 'java',
    kt: 'kotlin',
    kts: 'kotlin',
    swift: 'swift',
    c: 'c',
    h: 'c',
    cpp: 'cpp',
    cxx: 'cpp',
    hpp: 'cpp',
    cs: 'csharp',
    fs: 'fsharp',
    fsx: 'fsharp',
    php: 'php',
    sh: 'shell',
    bash: 'shell',
    zsh: 'shell',
    pl: 'perl',
    pm: 'perl',
    lua: 'lua',
    r: 'r',
    sql: 'sql',
    ps1: 'powershell',
    psd1: 'powershell',
    psm1: 'powershell',
    clj: 'clojure',
    cljs: 'clojure',
    edn: 'clojure',
    coffe: 'coffeescript',
    coffee: 'coffeescript',
    dockerfile: 'dockerfile',
    ini: 'ini',
    cfg: 'ini',
    conf: 'ini',
    bat: 'bat',
    cmd: 'bat',
    tex: 'latex',
    vb: 'vb'
  };

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
    if (contentType === 'text/x-java') return 'java';
    if (contentType === 'text/x-go') return 'go';
    if (contentType === 'text/x-rust') return 'rust';
    if (contentType === 'text/x-ruby') return 'ruby';
    if (contentType === 'text/x-php') return 'php';
    if (contentType === 'text/x-sh' || contentType === 'application/x-sh') return 'shell';
    if (contentType === 'text/x-sql') return 'sql';
    if (contentType === 'text/x-typescript') return 'typescript';
    if (contentType === 'text/x-csharp') return 'csharp';
    if (contentType === 'text/x-c++') return 'cpp';
    if (contentType.startsWith('text/') || contentType === 'application/octet-stream') {
      return extLanguageMap[extension] ?? 'plaintext';
    }
    return extLanguageMap[extension] ?? 'plaintext';
  });

  const workerImport = browser ? import('monaco-editor/esm/vs/editor/editor.worker?worker') : null;

  function toMonacoTheme(t: string): string {
    return t === 'dark' ? 'vs-dark' : 'vs';
  }

  $effect(() => {
    monaco?.editor.setTheme(toMonacoTheme(theme.current));
  });

  onMount(async () => {
    if (!browser) return;

    // Load Monaco's NLS bundle for the active locale. Static import strings are
    // required — Vite cannot bundle bare-specifier template literals at build time.
    if (getLocale() === 'de') {
      // @ts-expect-error — Monaco ESM nls bundle has no types
      await import('monaco-editor/esm/nls.messages.de.js');
    }

    const EditorWorker = (await workerImport!).default;
    self.MonacoEnvironment = {
      getWorker: () => new EditorWorker()
    };

    monaco = await import('monaco-editor');

    editor = monaco.editor.create(container, {
      value,
      language,
      readOnly: readonly,
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

    if (!readonly) {
      editor.focus();
    }

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
      class="text-base-content/90 bg-base-200/50 h-full overflow-auto p-4 font-mono text-xs whitespace-pre-wrap"
      class:opacity-60={readonly}
      aria-readonly={readonly || undefined}>{value}</pre>
  {/if}
</div>
