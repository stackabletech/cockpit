<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { browser } from '$app/environment';
  import { theme } from '$lib/theme.svelte';
  import { registerTrinoSql, TRINO_SQL_LANGUAGE_ID } from '$lib/editor/trinosql';

  let {
    value = $bindable(),
    language = TRINO_SQL_LANGUAGE_ID,
    onExecute,
    onExecuteAll
  }: {
    value?: string;
    language?: string;
    onExecute?: () => void;
    onExecuteAll?: () => void;
  } = $props();

  let container: HTMLDivElement;
  let editor: import('monaco-editor').editor.IStandaloneCodeEditor | undefined;
  let monaco = $state<typeof import('monaco-editor') | undefined>(undefined);
  let ready = $state(false);

  // Cache the last multi-line selection so it survives focus loss (e.g. clicking Run button).
  let lastSelection: { startOffset: number; endOffset: number } | null = null;

  export function getViewState(): import('monaco-editor').editor.ICodeEditorViewState | null {
    return editor?.saveViewState() ?? null;
  }

  export function restoreViewState(
    state: import('monaco-editor').editor.ICodeEditorViewState | null
  ) {
    if (editor && state) {
      editor.restoreViewState(state);
    }
  }

  export function setValue(text: string) {
    if (editor) {
      editor.setValue(text);
    }
  }

  export function getCursorOffset(): number | null {
    if (!editor) return null;
    const model = editor.getModel();
    if (!model) return null;
    return model.getOffsetAt(editor.getPosition()!);
  }

  export function getSelection(): { startOffset: number; endOffset: number } | null {
    if (!editor) return null;
    const sel = editor.getSelection();
    if (sel && !sel.isEmpty() && sel.startLineNumber !== sel.endLineNumber) {
      const model = editor.getModel();
      if (!model) return null;
      return {
        startOffset: model.getOffsetAt(sel.getStartPosition()),
        endOffset: model.getOffsetAt(sel.getEndPosition())
      };
    }
    // Fall back to cached selection from before blur.
    return lastSelection;
  }

  export function clearSelection(): void {
    lastSelection = null;
  }

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
      lastSelection = null;
    });

    editor.onDidBlurEditorWidget(() => {
      const sel = editor!.getSelection();
      const model = editor!.getModel();
      if (sel && !sel.isEmpty() && sel.startLineNumber !== sel.endLineNumber && model) {
        lastSelection = {
          startOffset: model.getOffsetAt(sel.getStartPosition()),
          endOffset: model.getOffsetAt(sel.getEndPosition())
        };
      } else {
        lastSelection = null;
      }
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

    if (onExecuteAll) {
      editor.addAction({
        id: 'execute-all',
        label: 'Execute All Queries',
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Enter],
        run: onExecuteAll
      });
    }
  });

  onDestroy(() => {
    editor?.dispose();
  });
</script>

<div bind:this={container} class="h-full w-full" data-ready={ready || undefined}></div>
