<script lang="ts">
  import { onDestroy } from 'svelte';
  import { browser } from '$app/environment';
  import { SvelteURLSearchParams } from 'svelte/reactivity';
  import IconCloseFullscreen from 'virtual:icons/material-symbols/close-fullscreen';
  import IconOpenInFull from 'virtual:icons/material-symbols/open-in-full';
  import IconClose from 'virtual:icons/material-symbols/close';
  import IconErrorOutline from 'virtual:icons/material-symbols/error-outline';
  import IconDownload from 'virtual:icons/material-symbols/download';
  import IconSave from 'virtual:icons/material-symbols/save';
  import IconBlock from 'virtual:icons/material-symbols/block';
  import * as m from '$lib/paraglide/messages.js';
  import Modal from '$lib/components/Modal.svelte';
  import TextEditor from '$lib/components/editor/TextEditor.svelte';
  import UnsavedConfirmDialog from './UnsavedConfirmDialog.svelte';
  import CsvPreview from './preview/CsvPreview.svelte';
  import ImagePreview from './preview/ImagePreview.svelte';
  import PdfPreview from './preview/PdfPreview.svelte';
  import FallbackPreview from './preview/FallbackPreview.svelte';
  import { keyToName, formatFileSize } from '$lib/storage/utils.js';
  import { downloadObject, DownloadError } from '$lib/storage/download.js';
  import { loadConnectionLocally, getConnectionHeader } from '$lib/storage/connection-storage.js';
  import { addToast } from '$lib/stores/toast.svelte.js';
  import { STORAGE_CONNECTION_HEADER } from '$lib/storage/connection-storage.js';
  import { maxEditableFileSize } from '$lib/client/feature-flags.js';

  interface Props {
    open: boolean;
    bucket: string;
    objectKey: string | null;
  }

  let { open = $bindable(false), bucket, objectKey }: Props = $props();

  type PreviewKind =
    | { kind: 'idle' }
    | { kind: 'loading' }
    | {
        kind: 'text';
        text: string;
        contentType: string;
        truncated: boolean;
        totalSize: number;
        previewBytes: number;
      }
    | { kind: 'csv'; text: string; truncated: boolean; totalSize: number; previewBytes: number }
    | {
        kind: 'parquet';
        text: string;
        truncated: boolean;
        totalSize: number;
        totalRows: number;
        previewRows: number;
      }
    | { kind: 'image'; blobUrl: string; contentType: string; totalSize: number }
    | { kind: 'pdf'; blobUrl: string; totalSize: number }
    | { kind: 'fallback'; contentType: string; isBinary: boolean }
    | { kind: 'error'; message: string };

  let preview: PreviewKind = $state({ kind: 'idle' });
  let blobUrls: string[] = [];
  let maximized = $state(false);
  let imageNaturalWidth = $state(0);
  let imageNaturalHeight = $state(0);

  // ── Text editor state ──
  let editorText = $state('');
  let originalText = $state('');
  let saving = $state(false);
  let showUnsavedConfirm = $state(false);
  let editorReady = $state(false);

  const dirty = $derived(editorText !== originalText);

  // Prevent accidental browser tab/window close when there are unsaved changes.
  $effect(() => {
    if (!dirty) return;

    function handleBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
    }

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  });

  const filename = $derived(objectKey ? keyToName(objectKey) : '');

  function isTooLargeToEdit(): boolean {
    if (preview.kind !== 'text') return false;
    return preview.totalSize > maxEditableFileSize;
  }

  onDestroy(() => {
    for (const url of blobUrls) {
      URL.revokeObjectURL(url);
    }
  });

  function revokeBlobUrls() {
    for (const url of blobUrls) {
      URL.revokeObjectURL(url);
    }
    blobUrls = [];
  }

  $effect(() => {
    if (open && objectKey) {
      editorReady = false;
      void loadPreview(objectKey, bucket);
      // Start loading Monaco in parallel with data fetching
      if (browser) {
        import('monaco-editor/esm/vs/editor/editor.worker?worker');
        import('monaco-editor');
      }
    }
    if (!open) {
      revokeBlobUrls();
      preview = { kind: 'idle' };
      imageNaturalWidth = 0;
      imageNaturalHeight = 0;
      editorReady = false;
      editorText = '';
      originalText = '';
    }
  });

  async function loadPreview(key: string, bkt: string) {
    preview = { kind: 'loading' };
    revokeBlobUrls();

    const conn = loadConnectionLocally();
    const headers: HeadersInit = conn
      ? { [STORAGE_CONNECTION_HEADER]: getConnectionHeader(conn) }
      : {};

    try {
      const params = new URLSearchParams({ bucket: bkt, key });
      const res = await fetch(`/api/storage/preview?${params}`, { headers });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        const msg =
          res.status === 403
            ? m.storage_preview_access_denied()
            : res.status === 404
              ? m.storage_preview_not_found()
              : (errBody?.error ?? m.storage_preview_error_desc());
        preview = { kind: 'error', message: msg };
        return;
      }

      const contentType = (res.headers.get('Content-Type') ?? 'application/octet-stream')
        .split(';')[0]
        .trim();
      const format = res.headers.get('X-Preview-Format');
      const truncated = res.headers.get('X-Preview-Truncated') === 'true';
      const totalSize = Number(res.headers.get('X-Preview-Total-Size') ?? '0');
      const previewBytes = Number(res.headers.get('X-Preview-Bytes') ?? '0');
      const totalRows = Number(res.headers.get('X-Preview-Total-Rows') ?? '0');
      const previewRows = Number(res.headers.get('X-Preview-Preview-Rows') ?? '0');

      if (res.headers.get('X-Preview-Renderable') === 'false') {
        await res.body?.cancel();
        preview = { kind: 'fallback', contentType, isBinary: false };
        return;
      }

      if (contentType.startsWith('image/')) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        blobUrls = [url];
        preview = { kind: 'image', blobUrl: url, contentType, totalSize };
        return;
      }

      if (contentType === 'application/pdf') {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        blobUrls = [url];
        preview = { kind: 'pdf', blobUrl: url, totalSize };
        return;
      }

      const text = await readTextSafely(res, key);
      if (text === null) {
        preview = { kind: 'fallback', contentType, isBinary: true };
        return;
      }

      if (format === 'parquet') {
        preview = { kind: 'parquet', text, truncated, totalSize, totalRows, previewRows };
        return;
      }

      if (
        contentType === 'text/csv' ||
        contentType === 'application/csv' ||
        contentType === 'application/vnd.ms-excel' ||
        key.toLowerCase().endsWith('.csv')
      ) {
        preview = { kind: 'csv', text, truncated, totalSize, previewBytes };
        return;
      }

      preview = { kind: 'text', text, contentType, truncated, totalSize, previewBytes };
      editorText = text;
      originalText = text;
    } catch {
      preview = { kind: 'error', message: m.storage_preview_error_desc() };
    }
  }

  async function readTextSafely(res: Response, key: string): Promise<string | null> {
    try {
      const buf = await res.arrayBuffer();
      const bytes = new Uint8Array(buf);

      if (bytes.length >= 2) {
        if (bytes[0] === 0xff && bytes[1] === 0xfe) {
          return new TextDecoder('utf-16le').decode(buf);
        }
        if (bytes[0] === 0xfe && bytes[1] === 0xff) {
          return new TextDecoder('utf-16be').decode(buf);
        }
      }

      try {
        return new TextDecoder('utf-8', { fatal: true }).decode(buf);
      } catch {
        const lowerKey = key.toLowerCase();
        if (lowerKey.endsWith('.csv') || lowerKey.endsWith('.tsv')) {
          return new TextDecoder('windows-1252').decode(buf);
        }
        return null;
      }
    } catch {
      return null;
    }
  }

  async function triggerDownload() {
    if (!objectKey) return;
    const conn = loadConnectionLocally();
    if (!conn) {
      addToast('error', m.storage_download_error_unknown());
      return;
    }
    try {
      await downloadObject(bucket, objectKey, getConnectionHeader(conn));
    } catch (err) {
      if (err instanceof DownloadError) {
        addToast('error', err.message);
      } else {
        addToast('error', m.storage_download_error_unknown());
      }
    }
  }

  function getSaveTextParams(): URLSearchParams | null {
    if (preview.kind !== 'text' || !objectKey) return null;
    const params = new SvelteURLSearchParams({ bucket, key: objectKey });
    params.set('contentType', preview.contentType);
    params.set('originalSize', String(preview.totalSize));
    params.set('previewBytes', String(preview.previewBytes));
    return params;
  }

  async function handleSave() {
    if (!objectKey) return;
    if (isTooLargeToEdit()) {
      addToast('error', m.storage_editor_too_large({ limit: formatFileSize(maxEditableFileSize) }));
      return;
    }
    const params = getSaveTextParams();
    if (!params) return;

    saving = true;
    try {
      const conn = loadConnectionLocally();
      const headers: HeadersInit = {};
      if (conn) {
        (headers as Record<string, string>)[STORAGE_CONNECTION_HEADER] = getConnectionHeader(conn);
      }

      const res = await fetch(`/api/storage/save-text?${params}`, {
        method: 'POST',
        headers,
        body: editorText
      });

      if (!res.ok) {
        if (res.status === 401) {
          addToast('error', m.storage_upload_error_not_connected());
        } else if (res.status === 403) {
          addToast('error', m.storage_upload_error_access_denied());
        } else if (res.status === 413) {
          addToast(
            'error',
            m.storage_editor_too_large({ limit: formatFileSize(maxEditableFileSize) })
          );
        } else {
          addToast('error', m.storage_editor_error());
        }
        return;
      }

      originalText = editorText;
      addToast('success', m.storage_editor_saved());
    } catch {
      addToast('error', m.storage_editor_error());
    } finally {
      saving = false;
    }
  }

  async function handleSaveAndClose() {
    await handleSave();
    if (originalText === editorText) {
      showUnsavedConfirm = false;
      close();
    }
  }

  function handleDiscard() {
    showUnsavedConfirm = false;
    editorText = originalText;
    close();
  }

  function handleCloseClick() {
    if (dirty) {
      showUnsavedConfirm = true;
    } else {
      close();
    }
  }

  function closeguard(): boolean {
    if (dirty) {
      showUnsavedConfirm = true;
      return false;
    }
    return true;
  }

  function close() {
    open = false;
  }

  function toggleMaximized() {
    maximized = !maximized;
  }
</script>

<Modal bind:open {closeguard} class="modal">
  <div
    class="modal-box flex flex-col p-0 transition-none
      {maximized ? 'h-dvh max-h-dvh w-screen max-w-none rounded-none' : 'w-full max-w-5xl'}"
    style={maximized ? '' : 'height: min(88dvh, 900px)'}
  >
    <!-- Header -->
    <div class="border-base-300 flex shrink-0 items-center gap-3 border-b px-5 py-2">
      <div class="min-w-0 flex-1">
        <h2 class="text-base-content truncate font-semibold" id="preview-modal-title">
          {filename}
        </h2>
        {#if preview.kind === 'text' || preview.kind === 'csv'}
          <div class="mt-1 flex flex-wrap items-center gap-1">
            <span class="badge badge-neutral badge-sm font-mono"
              >{formatFileSize(preview.totalSize)}</span
            >
            {#if preview.truncated}
              <span class="badge badge-soft badge-warning badge-sm">
                {m.storage_preview_truncated({
                  size: formatFileSize(preview.previewBytes)
                })}
              </span>
            {/if}
          </div>
        {:else if preview.kind === 'parquet'}
          <div class="mt-1 flex flex-wrap items-center gap-1">
            <span class="badge badge-neutral badge-sm font-mono"
              >{formatFileSize(preview.totalSize)}</span
            >
            {#if preview.truncated}
              <span class="badge badge-soft badge-warning badge-sm">
                {m.storage_preview_parquet_rows({
                  count: preview.previewRows,
                  total: preview.totalRows
                })}
              </span>
            {/if}
          </div>
        {:else if preview.kind === 'image' || preview.kind === 'pdf'}
          <div class="mt-1 flex flex-wrap items-center gap-1">
            <span class="badge badge-neutral badge-sm font-mono"
              >{formatFileSize(preview.totalSize)}</span
            >
            {#if preview.kind === 'image' && imageNaturalWidth > 0}
              <span class="badge badge-neutral badge-sm font-mono"
                >{imageNaturalWidth} &times; {imageNaturalHeight} px</span
              >
            {/if}
          </div>
        {/if}
      </div>
      {#if maximized}
        {@const MaximizeIcon = IconCloseFullscreen}
        <button
          class="btn btn-ghost btn-sm btn-square"
          onclick={toggleMaximized}
          aria-label={m.storage_preview_restore()}
        >
          <MaximizeIcon class="size-4" aria-hidden="true" />
        </button>
      {:else}
        {@const MaximizeIcon = IconOpenInFull}
        <button
          class="btn btn-ghost btn-sm btn-square"
          onclick={toggleMaximized}
          aria-label={m.storage_preview_maximise()}
        >
          <MaximizeIcon class="size-4" aria-hidden="true" />
        </button>
      {/if}
      <button
        class="btn btn-ghost btn-sm btn-square"
        onclick={handleCloseClick}
        aria-label={m.storage_preview_close()}
      >
        <IconClose class="size-5" aria-hidden="true" />
      </button>
    </div>

    <!-- Body -->
    <div class="min-h-0 min-w-0 flex-1 overflow-hidden">
      {#if preview.kind === 'idle' || preview.kind === 'loading'}
        <div
          class="flex items-center justify-center p-12"
          aria-live="polite"
          aria-label={m.storage_preview_loading()}
        >
          <span class="loading loading-spinner loading-md text-primary" aria-hidden="true"></span>
          <span class="sr-only">{m.storage_preview_loading()}</span>
        </div>
      {:else if preview.kind === 'error'}
        <div class="flex flex-col items-center gap-3 p-8 text-center" role="alert">
          <IconErrorOutline class="text-error size-12" aria-hidden="true" />
          <p class="text-base-content font-semibold">{m.storage_preview_error_title()}</p>
          <p class="text-base-content/60 text-sm">{preview.message}</p>
        </div>
      {:else if preview.kind === 'text'}
        <div class="relative flex h-full flex-col">
          {#if !editorReady}
            <div
              class="bg-base-100/80 absolute inset-0 z-10 flex items-center justify-center"
              aria-live="polite"
              aria-label={m.storage_preview_loading()}
            >
              <span class="loading loading-spinner loading-md text-primary" aria-hidden="true"
              ></span>
              <span class="sr-only">{m.storage_preview_loading()}</span>
            </div>
          {/if}
          {#if isTooLargeToEdit()}
            <div
              class="bg-base-200 border-base-300 flex shrink-0 items-center gap-2 border-b px-4 py-2"
            >
              <IconBlock class="text-base-content/50 size-4" aria-hidden="true" />
              <span class="text-base-content/60 text-xs">
                {m.storage_editor_too_large_badge({ limit: formatFileSize(maxEditableFileSize) })}
              </span>
            </div>
          {/if}
          <div class="min-h-0 flex-1">
            <TextEditor
              bind:value={editorText}
              bind:ready={editorReady}
              contentType={preview.contentType}
              {filename}
              readonly={isTooLargeToEdit()}
              onSave={handleSave}
            />
          </div>
        </div>
      {:else if preview.kind === 'csv'}
        <div class="preview-scroll h-full overflow-scroll">
          <CsvPreview text={preview.text} />
        </div>
      {:else if preview.kind === 'parquet'}
        <div class="preview-scroll h-full overflow-scroll">
          <CsvPreview text={preview.text} />
        </div>
      {:else if preview.kind === 'image'}
        <div class="preview-scroll h-full overflow-scroll">
          <ImagePreview
            src={preview.blobUrl}
            name={filename}
            bind:naturalWidth={imageNaturalWidth}
            bind:naturalHeight={imageNaturalHeight}
          />
        </div>
      {:else if preview.kind === 'pdf'}
        <div class="preview-scroll h-full overflow-scroll">
          <PdfPreview src={preview.blobUrl} name={filename} />
        </div>
      {:else if preview.kind === 'fallback'}
        <div class="preview-scroll h-full overflow-scroll">
          <FallbackPreview
            contentType={preview.contentType}
            onDownload={triggerDownload}
            isBinary={preview.isBinary}
          />
        </div>
      {/if}
    </div>

    <!-- Footer -->
    {#if preview.kind === 'text' || preview.kind === 'csv' || preview.kind === 'parquet' || preview.kind === 'image' || preview.kind === 'pdf'}
      <div class="border-base-300 flex shrink-0 items-center justify-end gap-2 border-t px-5 py-2">
        {#if preview.kind === 'text' && preview.truncated}
          <button type="button" class="btn btn-ghost btn-sm gap-1.5" onclick={triggerDownload}>
            <IconDownload class="size-4" aria-hidden="true" />
            {m.storage_preview_download_full()}
          </button>
        {:else if preview.kind === 'csv' && preview.truncated}
          <button type="button" class="btn btn-ghost btn-sm gap-1.5" onclick={triggerDownload}>
            <IconDownload class="size-4" aria-hidden="true" />
            {m.storage_preview_download_full()}
          </button>
        {:else if preview.kind === 'image' || preview.kind === 'pdf'}
          <button type="button" class="btn btn-ghost btn-sm gap-1.5" onclick={triggerDownload}>
            <IconDownload class="size-4" aria-hidden="true" />
            {m.storage_preview_download_full()}
          </button>
        {/if}
        {#if preview.kind === 'text' && !isTooLargeToEdit()}
          <button
            type="button"
            class="btn btn-primary btn-sm gap-1.5"
            onclick={handleSave}
            disabled={!dirty || saving}
          >
            {#if saving}
              <span class="loading loading-spinner loading-xs" aria-hidden="true"></span>
              {m.storage_editor_saving()}
            {:else}
              <IconSave class="size-4" aria-hidden="true" />
              {m.storage_editor_save()}
            {/if}
          </button>
        {/if}
        <button class="btn btn-ghost btn-sm" onclick={handleCloseClick}>
          {m.storage_preview_close()}
        </button>
      </div>
    {/if}
  </div>
</Modal>

<!-- Unsaved changes confirmation -->
<UnsavedConfirmDialog
  bind:open={showUnsavedConfirm}
  onSave={handleSaveAndClose}
  onDiscard={handleDiscard}
  onCancel={() => (showUnsavedConfirm = false)}
/>
