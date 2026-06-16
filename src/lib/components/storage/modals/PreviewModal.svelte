<script lang="ts">
  import { onDestroy } from 'svelte';
  import IconCloseFullscreen from 'virtual:icons/material-symbols/close-fullscreen';
  import IconOpenInFull from 'virtual:icons/material-symbols/open-in-full';
  import IconClose from 'virtual:icons/material-symbols/close';
  import IconErrorOutline from 'virtual:icons/material-symbols/error-outline';
  import IconDownload from 'virtual:icons/material-symbols/download';
  import * as m from '$lib/paraglide/messages.js';
  import { getLocale } from '$lib/paraglide/runtime.js';
  import Modal from '$lib/components/Modal.svelte';
  import TextPreview from './preview/TextPreview.svelte';
  import CsvPreview from './preview/CsvPreview.svelte';
  import ParquetPreview from './preview/ParquetPreview.svelte';
  import ImagePreview from './preview/ImagePreview.svelte';
  import PdfPreview from './preview/PdfPreview.svelte';
  import FallbackPreview from './preview/FallbackPreview.svelte';
  import { keyToName, formatFileSize } from '$lib/storage/utils.js';
  import { downloadObject, DownloadError } from '$lib/storage/download.js';
  import { loadConnectionLocally, getConnectionHeader } from '$lib/storage/connection-storage.js';
  import { addToast } from '$lib/stores/toast.svelte.js';
  import { STORAGE_CONNECTION_HEADER } from '$lib/storage/connection-storage.js';

  interface Props {
    open?: boolean;
    bucket?: string;
    objectKey?: string | null;
  }

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
        headers: string[];
        rows: unknown[][];
        truncated: boolean;
        totalSize: number;
        totalRows: number;
      }
    | { kind: 'image'; blobUrl: string; contentType: string; totalSize: number }
    | { kind: 'pdf'; blobUrl: string; totalSize: number }
    | { kind: 'fallback'; contentType: string; isBinary: boolean }
    | { kind: 'error'; message: string };

  let { open = $bindable(false), bucket = '', objectKey = null }: Props = $props();

  let preview: PreviewKind = $state({ kind: 'idle' });
  let blobUrls: string[] = [];
  let maximized = $state(false);
  let imageNaturalWidth = $state(0);
  let imageNaturalHeight = $state(0);
  let parquetShowingRowsCount = $state(0);

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
      void loadPreview(objectKey, bucket);
    }

    if (!open) {
      revokeBlobUrls();
      preview = { kind: 'idle' };
      imageNaturalWidth = 0;
      imageNaturalHeight = 0;
    }
  });

  async function loadPreview(key: string, activeBucket: string) {
    preview = { kind: 'loading' };
    revokeBlobUrls();

    const conn = loadConnectionLocally();
    const headers: HeadersInit = conn
      ? { [STORAGE_CONNECTION_HEADER]: getConnectionHeader(conn) }
      : {};

    try {
      const params = new URLSearchParams({ bucket: activeBucket, key });
      const res = await fetch(`/storage/api/preview?${params}`, { headers });

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

      if (format === 'parquet') {
        try {
          await parseParquetStream(
            res,
            (headers, totalRows) => {
              preview = {
                kind: 'parquet',
                headers,
                rows: [],
                truncated,
                totalSize,
                totalRows
              };
            },
            (name, values) => {
              if (preview.kind !== 'parquet') return;
              const colIdx = preview.headers.indexOf(name);
              if (colIdx < 0) return;
              const rows = preview.rows;
              while (rows.length < values.length) {
                rows.push(new Array(preview.headers.length).fill(undefined));
              }
              for (let i = 0; i < values.length; i++) {
                rows[i][colIdx] = values[i];
              }
              // Create new array reference so ParquetPreview detects the update
              preview = { ...preview, rows: rows.slice() };
            }
          );
        } catch {
          preview = { kind: 'error', message: m.storage_preview_error_desc() };
        }
        return;
      }

      const text = await readTextSafely(res, key);
      if (text === null) {
        preview = { kind: 'fallback', contentType, isBinary: true };
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

  const filename = $derived(objectKey ? keyToName(objectKey) : '');

  /** Parse an NDJSON parquet stream with immediate callbacks for headers and columns. */
  async function parseParquetStream(
    res: Response,
    onHeaders: (headers: string[], totalRows: number) => void,
    onColumn: (name: string, values: unknown[]) => void
  ): Promise<void> {
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        const msg = JSON.parse(line);

        if (msg.t === 'h') {
          onHeaders(msg.h, msg.tr);
        } else if (msg.t === 'c') {
          onColumn(msg.n, msg.v);
        } else if (msg.t === 'e') {
          throw new Error('Server error reading parquet data');
        }
        // 'd' (done) — continue reading until stream ends
      }
    }
  }

  /** Read an NDJSON streaming response and progressively fill column data. */
  async function readNdjsonStream(
    res: Response,
    onColumn?: (name: string, values: unknown[]) => void
  ): Promise<{ headers: string[]; rows: unknown[][]; totalRows: number }> {
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let resultHeaders: string[] = [];
    let rows: unknown[][] = [];
    let resultTotalRows = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        const msg = JSON.parse(line);

        if (msg.t === 'h') {
          resultHeaders = msg.h;
          resultTotalRows = msg.tr;
        } else if (msg.t === 'c') {
          const colIdx = resultHeaders.indexOf(msg.n);
          if (colIdx < 0) continue;
          const values = msg.v as unknown[];
          while (rows.length < values.length) {
            rows.push(new Array(resultHeaders.length).fill(undefined));
          }
          for (let i = 0; i < values.length; i++) {
            if (!rows[i]) rows[i] = new Array(resultHeaders.length).fill(undefined);
            rows[i][colIdx] = values[i];
          }
          onColumn?.(msg.n, values);
        } else if (msg.t === 'e') {
          throw new Error('Server error reading parquet data');
        }
        // 'd' (done) — just continue reading until stream ends
      }
    }

    return { headers: resultHeaders, rows, totalRows: resultTotalRows };
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

  function close() {
    open = false;
  }

  // Sync parquetShowingRowsCount with the preview data and ParquetPreview's loaded chunks
  $effect(() => {
    if (preview.kind === 'parquet') {
      parquetShowingRowsCount = preview.rows.length;
    }
  });

  function toggleMaximized() {
    maximized = !maximized;
  }

  // Function to fetch additional parquet chunks during infinite scroll
  async function fetchParquetRows(
    offset: number,
    limit: number,
    onColumn?: (name: string, values: unknown[]) => void
  ): Promise<unknown[][]> {
    if (!objectKey) return [];

    const conn = loadConnectionLocally();
    const fetchHeaders: HeadersInit = conn
      ? { [STORAGE_CONNECTION_HEADER]: getConnectionHeader(conn) }
      : {};

    const params = new URLSearchParams({
      bucket,
      key: objectKey,
      offset: String(offset),
      limit: String(limit)
    });

    const res = await fetch(`/storage/api/preview?${params}`, { headers: fetchHeaders });

    if (!res.ok) {
      throw new Error('Failed to fetch parquet chunk');
    }

    const { rows } = await readNdjsonStream(res, onColumn);
    return rows;
  }
</script>

<Modal bind:open class="modal">
  <div
    class="modal-box flex flex-col p-0 transition-none {maximized
      ? 'h-dvh max-h-dvh w-screen max-w-none rounded-none'
      : 'w-full max-w-5xl'}"
    style={maximized ? '' : 'height: min(88dvh, 900px)'}
  >
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
                {m.storage_preview_truncated({ size: formatFileSize(preview.previewBytes) })}
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
                  count: parquetShowingRowsCount.toLocaleString(getLocale()),
                  total: preview.totalRows.toLocaleString(getLocale())
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
              <span class="badge badge-neutral badge-sm font-mono">
                {imageNaturalWidth} &times; {imageNaturalHeight} px
              </span>
            {/if}
          </div>
        {/if}
      </div>

      {#if maximized}
        <button
          class="btn btn-ghost btn-sm btn-square"
          onclick={toggleMaximized}
          aria-label="Restore"
        >
          <IconCloseFullscreen class="size-4" aria-hidden="true" />
        </button>
      {:else}
        <button
          class="btn btn-ghost btn-sm btn-square"
          onclick={toggleMaximized}
          aria-label="Maximise"
        >
          <IconOpenInFull class="size-4" aria-hidden="true" />
        </button>
      {/if}

      <button
        class="btn btn-ghost btn-sm btn-square"
        onclick={close}
        aria-label={m.storage_preview_close()}
      >
        <IconClose class="size-5" aria-hidden="true" />
      </button>
    </div>

    <div class="min-h-0 min-w-0 flex-1 overflow-auto">
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
        <TextPreview text={preview.text} contentType={preview.contentType} />
      {:else if preview.kind === 'csv'}
        <CsvPreview text={preview.text} />
      {:else if preview.kind === 'parquet'}
        <ParquetPreview
          headers={preview.headers}
          initialRows={preview.rows}
          totalRows={preview.totalRows}
          fetchRows={fetchParquetRows}
          bind:showingRowsCount={parquetShowingRowsCount}
        />
      {:else if preview.kind === 'image'}
        <ImagePreview
          src={preview.blobUrl}
          name={filename}
          bind:naturalWidth={imageNaturalWidth}
          bind:naturalHeight={imageNaturalHeight}
        />
      {:else if preview.kind === 'pdf'}
        <PdfPreview src={preview.blobUrl} name={filename} />
      {:else if preview.kind === 'fallback'}
        <FallbackPreview
          contentType={preview.contentType}
          onDownload={triggerDownload}
          isBinary={preview.isBinary}
        />
      {/if}
    </div>

    {#if preview.kind === 'text' || preview.kind === 'csv' || preview.kind === 'parquet' || preview.kind === 'image' || preview.kind === 'pdf'}
      <div class="border-base-300 flex shrink-0 items-center justify-end gap-2 border-t px-5 py-2">
        {#if (preview.kind === 'text' || preview.kind === 'csv') && preview.truncated}
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

        <button class="btn btn-primary btn-sm" onclick={close}>
          {m.storage_preview_close()}
        </button>
      </div>
    {/if}
  </div>
</Modal>
