<script lang="ts">
  import { onDestroy } from 'svelte';
  import IconCloseFullscreen from 'virtual:icons/material-symbols/close-fullscreen';
  import IconOpenInFull from 'virtual:icons/material-symbols/open-in-full';
  import IconClose from 'virtual:icons/material-symbols/close';
  import IconErrorOutline from 'virtual:icons/material-symbols/error-outline';
  import IconDownload from 'virtual:icons/material-symbols/download';
  import IconFilePresent from 'virtual:icons/material-symbols/file-present';
  import * as m from '$lib/paraglide/messages.js';
  import { getLocale } from '$lib/paraglide/runtime.js';
  import Modal from '$lib/components/Modal.svelte';
  import TextPreview from './preview/TextPreview.svelte';
  import CsvPreview from './preview/CsvPreview.svelte';
  import ParquetPreview from './preview/ParquetPreview.svelte';
  import ParquetMetadata from './preview/ParquetMetadata.svelte';
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

  interface ColumnTypeInfo {
    name: string;
    type: string;
  }

  interface ParquetFileMeta {
    rowGroups: number;
    compressionCodecs: string[];
    hasOffsetIndex: boolean;
    hasColumnIndex: boolean;
    createdBy: string | null;
    version: number;
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
        columnTypes: ColumnTypeInfo[];
        metadata: ParquetFileMeta;
        rows: unknown[][];
        dataBlocked: boolean;
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
  let parquetTab: 'metadata' | 'data' = $state('metadata');

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
      parquetTab = 'metadata';
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

      // Parquet takes priority — parse header for metadata (always), load data on-demand
      if (format === 'parquet') {
        try {
          const dataBlocked = res.headers.get('X-Preview-Data-Blocked') === 'true';
          await parseParquetStream(
            res,
            (headers, totalRows, columnTypes, metadata) => {
              preview = {
                kind: 'parquet',
                headers,
                columnTypes,
                metadata,
                rows: [],
                dataBlocked,
                truncated,
                totalSize,
                totalRows
              };
            },
            () => {
              // Ignore any column data in the initial load (metadata-only request)
            }
          );
        } catch {
          preview = { kind: 'error', message: m.storage_preview_error_desc() };
        }
        return;
      }

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

  /** Parse an NDJSON parquet stream with callbacks for headers (incl. schema/metadata) and columns. */
  async function parseParquetStream(
    res: Response,
    onHeaders: (
      headers: string[],
      totalRows: number,
      columnTypes: ColumnTypeInfo[],
      metadata: ParquetFileMeta
    ) => void,
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
          onHeaders(
            msg.h,
            msg.tr,
            msg.s ?? [],
            msg.m ?? {
              rowGroups: 0,
              compressionCodecs: [],
              hasOffsetIndex: false,
              hasColumnIndex: false,
              createdBy: null,
              version: 0
            }
          );
        } else if (msg.t === 'c') {
          onColumn(msg.n, msg.v);
        } else if (msg.t === 'e') {
          throw new Error('Server error reading parquet data');
        }
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
    const columnPos: Record<string, number> = {};

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
          let pos = columnPos[msg.n] ?? 0;
          for (let i = 0; i < values.length; i++) {
            while (rows.length <= pos) {
              rows.push(new Array(resultHeaders.length).fill(undefined));
            }
            rows[pos][colIdx] = values[i];
            pos++;
          }
          columnPos[msg.n] = pos;
          onColumn?.(msg.n, values);
        } else if (msg.t === 'e') {
          throw new Error('Server error reading parquet data');
        }
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

  // Sync parquetShowingRowsCount with the preview data
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
      limit: String(limit),
      data: 'true'
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
            {#if preview.dataBlocked}
              <span class="badge badge-soft badge-warning badge-sm">
                {m.storage_preview_parquet_blocked_title()}
              </span>
            {:else if preview.truncated}
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
          aria-label={m.storage_preview_restore()}
        >
          <IconCloseFullscreen class="size-4" aria-hidden="true" />
        </button>
      {:else}
        <button
          class="btn btn-ghost btn-sm btn-square"
          onclick={toggleMaximized}
          aria-label={m.storage_preview_maximise()}
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

    {#if preview.kind === 'parquet'}
      <div
        class="bg-base-200 border-base-300 flex gap-0 border-b"
        role="tablist"
        aria-label={m.storage_preview_parquet_tab_aria()}
      >
        <button
          class="relative flex-1 px-4 py-2.5 text-sm font-medium transition-colors {parquetTab ===
          'metadata'
            ? 'bg-base-100 text-primary'
            : 'text-base-content/60 hover:bg-base-100/50 hover:text-base-content'}"
          role="tab"
          aria-selected={parquetTab === 'metadata'}
          onclick={() => (parquetTab = 'metadata')}
        >
          {m.storage_preview_parquet_tab_metadata()}
          {#if parquetTab === 'metadata'}
            <span class="bg-primary absolute inset-x-0 bottom-0 h-0.5" aria-hidden="true"></span>
          {/if}
        </button>
        <button
          class="relative flex-1 px-4 py-2.5 text-sm font-medium transition-colors {parquetTab ===
          'data'
            ? 'bg-base-100 text-primary'
            : 'text-base-content/60 hover:bg-base-100/50 hover:text-base-content'}"
          role="tab"
          aria-selected={parquetTab === 'data'}
          onclick={() => (parquetTab = 'data')}
        >
          {m.storage_preview_parquet_tab_data()}
          {#if parquetTab === 'data'}
            <span class="bg-primary absolute inset-x-0 bottom-0 h-0.5" aria-hidden="true"></span>
          {/if}
        </button>
      </div>
    {/if}

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
      {:else if preview.kind === 'parquet'}
        <!-- Metadata tab: always mounted, hidden when Data tab is active -->
        <div class={parquetTab === 'metadata' ? 'h-full' : 'hidden h-full'}>
          <ParquetMetadata
            headers={preview.headers}
            columnTypes={preview.columnTypes}
            totalRows={preview.totalRows}
            totalSize={preview.totalSize}
            metadata={preview.metadata}
          />
        </div>
        <!-- Data tab: always mounted (preserves scroll + chunks), hidden when Metadata tab is active -->
        <div class={parquetTab === 'data' ? 'h-full' : 'hidden h-full'}>
          {#if preview.dataBlocked}
            <div class="flex min-h-full flex-col items-center justify-center gap-4 p-8 text-center">
              <IconFilePresent class="text-base-content/30 size-16" aria-hidden="true" />
              <div>
                <p class="text-base-content font-semibold">
                  {m.storage_preview_parquet_blocked_title()}
                </p>
                <p class="text-base-content/60 mt-1 text-sm">
                  {m.storage_preview_parquet_blocked_desc()}
                </p>
              </div>
              <button type="button" class="btn btn-primary btn-sm gap-2" onclick={triggerDownload}>
                <IconDownload class="size-4" aria-hidden="true" />
                {m.storage_preview_download_full()}
              </button>
            </div>
          {:else}
            <ParquetPreview
              headers={preview.headers}
              initialRows={preview.rows}
              totalRows={preview.totalRows}
              fetchRows={fetchParquetRows}
              bind:showingRowsCount={parquetShowingRowsCount}
              hidden={parquetTab !== 'data'}
            />
          {/if}
        </div>
      {:else if preview.kind === 'text'}
        <TextPreview text={preview.text} contentType={preview.contentType} />
      {:else if preview.kind === 'csv'}
        <CsvPreview text={preview.text} />
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
        {#if preview.kind === 'parquet' && preview.dataBlocked}
          <button type="button" class="btn btn-ghost btn-sm gap-1.5" onclick={triggerDownload}>
            <IconDownload class="size-4" aria-hidden="true" />
            {m.storage_preview_download_full()}
          </button>
        {:else if (preview.kind === 'text' || preview.kind === 'csv') && preview.truncated}
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
