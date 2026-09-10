<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { browser } from '$app/environment';
  import { theme } from '$lib/theme.svelte';
  import { getLocale } from '$lib/paraglide/runtime.js';
  import { prettifyJson } from '$lib/editor/format-json';

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

  const isJson = $derived(
    contentType === 'application/json' ||
      contentType === 'text/json' ||
      contentType.includes('+json') ||
      extension === 'json' ||
      extension === 'jsonc'
  );

  const displayValue = $derived.by(() => {
    if (!isJson) return value;
    const raw = value ?? '';
    return prettifyJson(raw);
  });

  const isReadonly = $derived(readonly || isJson);

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

  const cleanups: (() => void)[] = [];

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

    if (!container.isConnected) return;

    editor = monaco.editor.create(container, {
      value: displayValue,
      language,
      readOnly: isReadonly,
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

    // Ctrl+Mouse Wheel — zoom via built-in command (capture phase on document,
    // because Monaco's internal handler calls stopPropagation on wheel events,
    // so a container-level listener never fires)
    const onWheel = (e: WheelEvent) => {
      if ((e.ctrlKey || e.metaKey) && container.contains(e.target as Node)) {
        e.preventDefault();
        editor?.trigger(
          'keyboard',
          e.deltaY < 0 ? 'editor.action.fontZoomIn' : 'editor.action.fontZoomOut',
          {}
        );
      }
    };
    document.addEventListener('wheel', onWheel, { capture: true, passive: false });
    cleanups.push(() => document.removeEventListener('wheel', onWheel, { capture: true }));

    // Prevent browser zoom & invoke font zoom for any keys Monaco doesn't handle
    const handleZoomKeys = (e: KeyboardEvent) => {
      if (!editor?.hasTextFocus()) return;
      if (!(e.ctrlKey || e.metaKey)) return;
      let command: string | null = null;
      if (e.key === '=' || e.key === '+' || e.code === 'NumpadAdd') {
        command = 'editor.action.fontZoomIn';
      } else if (e.key === '-' || e.code === 'NumpadSubtract') {
        command = 'editor.action.fontZoomOut';
      } else if (e.key === '0' || e.code === 'Numpad0') {
        command = 'editor.action.fontZoomReset';
      }
      if (command) {
        if (!e.defaultPrevented) editor?.trigger('keyboard', command, {});
        e.preventDefault();
      }
    };
    document.addEventListener('keydown', handleZoomKeys);
    cleanups.push(() => document.removeEventListener('keydown', handleZoomKeys));

    // Bind keyboard shortcuts to the built-in font zoom commands
    const zoomDisposable = monaco!.editor.addKeybindingRules([
      {
        keybinding: monaco!.KeyMod.CtrlCmd | monaco!.KeyCode.Equal,
        command: 'editor.action.fontZoomIn',
        when: 'editorFocus'
      },
      {
        keybinding: monaco!.KeyMod.CtrlCmd | monaco!.KeyMod.Shift | monaco!.KeyCode.Equal,
        command: 'editor.action.fontZoomIn',
        when: 'editorFocus'
      },
      {
        keybinding: monaco!.KeyMod.CtrlCmd | monaco!.KeyCode.NumpadAdd,
        command: 'editor.action.fontZoomIn',
        when: 'editorFocus'
      },
      {
        keybinding: monaco!.KeyMod.CtrlCmd | monaco!.KeyCode.Minus,
        command: 'editor.action.fontZoomOut',
        when: 'editorFocus'
      },
      {
        keybinding: monaco!.KeyMod.CtrlCmd | monaco!.KeyCode.NumpadSubtract,
        command: 'editor.action.fontZoomOut',
        when: 'editorFocus'
      },
      {
        keybinding: monaco!.KeyMod.CtrlCmd | monaco!.KeyCode.Digit0,
        command: 'editor.action.fontZoomReset',
        when: 'editorFocus'
      },
      {
        keybinding: monaco!.KeyMod.CtrlCmd | monaco!.KeyCode.Numpad0,
        command: 'editor.action.fontZoomReset',
        when: 'editorFocus'
      }
    ]);
    cleanups.push(() => zoomDisposable.dispose());

    ready = true;
  });

  onDestroy(() => {
    cleanups.forEach((fn) => fn());
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
      class:opacity-60={isReadonly}
      aria-readonly={isReadonly || undefined}>{displayValue}</pre>
  {/if}
</div>
