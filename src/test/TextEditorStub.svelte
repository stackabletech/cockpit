<!--
  Test double for TextEditor: a plain textarea, so component tests can edit
  text and trigger `onSave` (Ctrl+S) without loading Monaco.
-->
<script lang="ts">
  import * as m from '$lib/paraglide/messages.js';

  let {
    value = $bindable(''),
    ready = $bindable(false),
    readonly = false,
    onSave
  }: {
    value?: string;
    ready?: boolean;
    readonly?: boolean;
    onSave?: () => void;
  } = $props();

  $effect(() => {
    ready = true;
  });

  function handleKeydown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      onSave?.();
    }
  }
</script>

<textarea aria-label={m.storage_editor_label()} bind:value {readonly} onkeydown={handleKeydown}
></textarea>
