<script lang="ts">
  import { onDestroy } from 'svelte';
  import IconCloseFullscreen from 'virtual:icons/material-symbols/close-fullscreen';
  import IconOpenInFull from 'virtual:icons/material-symbols/open-in-full';
  import IconClose from 'virtual:icons/material-symbols/close';
  import IconErrorOutline from 'virtual:icons/material-symbols/error-outline';
  import IconDownload from 'virtual:icons/material-symbols/download';
  import IconFilePresent from 'virtual:icons/material-symbols/file-present';
  import IconSave from 'virtual:icons/material-symbols/save';
  import IconBlock from 'virtual:icons/material-symbols/block';
  import * as m from '$lib/paraglide/messages.js';
  import { getLocale } from '$lib/paraglide/runtime.js';
  import Modal from '$lib/components/Modal.svelte';
  import TooltipTrigger from '$lib/components/TooltipTrigger.svelte';
  import TextEditor from '$lib/components/editor/TextEditor.svelte';
  import UnsavedConfirmDialog from './UnsavedConfirmDialog.svelte';
  import CsvPreview from './preview/CsvPreview.svelte';
  import ParquetPreview from './preview/ParquetPreview.svelte';
  import ParquetMetadata from './preview/ParquetMetadata.svelte';
  import ImagePreview from './preview/ImagePreview.svelte';
  import PdfPreview from './preview/PdfPreview.svelte';
  import FallbackPreview from './preview/FallbackPreview.svelte';
  import { keyToName, formatFileSize } from '$lib/storage/utils.js';
  import { StorageError } from '$lib/storage/errors.js';
  import { addToast } from '$lib/stores/toast.svelte.js';
  import { maxEditableFileSize, infiniteScrollEnabled } from '$lib/client/feature-flags.js';
  import { getStorageState } from '$lib/storage/context.js';

  interface Props {
    open?: boolean;
    bucket?: string;
    objectKey?: string | null;
    archiveKey?: string;
    archivePath?: string;
    nestedArchivePath?: string;
  }
  interface ColumnStats {
    nullCount: number | null;
    distinctCount: number | null;
    min: string | null;
    max: string | null;
  }

  interface ColumnTypeInfo {
    name: string;
    type: string;
    codec: string;
    compressedSize: number;
    uncompressedSize: number;
    stats: ColumnStats;
  }

  interface ParquetFileMeta {
    rowGroups: number;
    compressionCodecs: string[];
    compressionUniform: boolean;
    hasOffsetIndex: boolean;
    hasColumnIndex: boolean;
    createdBy: string | null;
    version: number;
    arrowSchema: string | null;
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
    | {
        kind: 'csv';
        text: string;
        truncated: boolean;
        totalSize: number;
        previewBytes: number;
        previewRows: number;
        previewColumns: number;
      }
    | {
        kind: 'csv_scroll';
        headers: string[];
        rows: unknown[][];
        truncated: boolean;
        totalSize: number;
        totalRows: number;
      }
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
    | { kind: 'fallback'; contentType: string; isBinary: boolean; imageTooLarge?: boolean }
    | { kind: 'error'; message: string };

  let {
    open = $bindable(false),
    bucket = '',
    objectKey = null,
    archiveKey = '',
    archivePath = '',
    nestedArchivePath = ''
  }: Props = $props();

  const storage = getStorageState();
  let preview: PreviewKind = $state({ kind: 'idle' }),
    blobUrls: string[] = [];
  let maximized = $state(false);
  let imageNaturalWidth = $state(0),
    imageNaturalHeight = $state(0);
  let parquetShowingRowsCount = $state(0),
    csvShowingRowsCount = $state(0);
  let csvTotalRows = $state(0);
  let parquetTab: 'metadata' | 'data' = $state('metadata'),
    parquetDataLoading = $state(false);
  let editorText = $state('');
  let originalText = $state('');
  let saving = $state(false);
  let showUnsavedConfirm = $state(false);
  let editorReady = $state(false);

  const dirty = $derived(editorText !== originalText);

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
    }

    if (!open) {
      revokeBlobUrls();
      preview = { kind: 'idle' };
      imageNaturalWidth = 0;
      imageNaturalHeight = 0;
      parquetTab = 'metadata';
      parquetDataLoading = false;
      parquetShowingRowsCount = 0;
      csvShowingRowsCount = 0;
      csvTotalRows = 0;
      editorReady = false;
      editorText = '';
      originalText = '';
    }
  });

  async function loadPreview(key: string, activeBucket: string) {
    preview = { kind: 'loading' };
    revokeBlobUrls();

    try {
      let res: Response;
      if (archiveKey && archivePath) {
        res = await storage.api.archiveExtract({
          bucket: activeBucket,
          key: archiveKey,
          path: archivePath,
          nestedArchivePath: nestedArchivePath || undefined
        });
      } else {
        res = await storage.api.preview({ bucket: activeBucket, key });
      }

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
      const totalSize = parseInt(
        res.headers.get('X-Preview-Total-Size') ?? res.headers.get('Content-Length') ?? '0',
        10
      );
      const previewBytes = parseInt(
        res.headers.get('X-Preview-Bytes') ?? res.headers.get('Content-Length') ?? '0',
        10
      );
      const truncated = res.headers.get('X-Preview-Truncated') === 'true';
      const previewRows = Number(res.headers.get('X-Preview-Preview-Rows') ?? '0');
      const previewColumns = Number(res.headers.get('X-Preview-Preview-Columns') ?? '0');

      if (contentType.startsWith('image/')) {
        if (truncated) {
          await res.body?.cancel();
          preview = { kind: 'fallback', contentType, isBinary: false, imageTooLarge: true };
          return;
        }
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

      if (res.headers.get('X-Preview-Format') === 'parquet') {
        const dataBlocked = res.headers.get('X-Preview-Data-Blocked') === 'true';
        let parquetHeaders: string[] = [];
        let parquetColumnTypes: ColumnTypeInfo[] = [];
        let parquetMeta: ParquetFileMeta = {
          rowGroups: 0,
          compressionCodecs: [],
          compressionUniform: true,
          hasOffsetIndex: false,
          hasColumnIndex: false,
          createdBy: null,
          version: 0,
          arrowSchema: null
        };
        const parquetRows: unknown[][] = [];
        const columnPos: Record<string, number> = {};
        let parquetTotalRows = 0;
        await parseParquetStream(
          res,
          (headers, totalRows, columnTypes, meta) => {
            parquetHeaders = headers;
            parquetTotalRows = totalRows;
            parquetColumnTypes = columnTypes;
            parquetMeta = meta;
          },
          (name, values) => {
            const colIdx = parquetHeaders.indexOf(name);
            if (colIdx < 0) return;
            let pos = columnPos[name] ?? 0;
            for (let i = 0; i < values.length; i++) {
              while (parquetRows.length <= pos) {
                parquetRows.push(new Array(parquetHeaders.length).fill(undefined));
              }
              parquetRows[pos][colIdx] = values[i];
              pos++;
            }
            columnPos[name] = pos;
          }
        );
        preview = {
          kind: 'parquet',
          headers: parquetHeaders,
          columnTypes: parquetColumnTypes,
          metadata: parquetMeta,
          rows: parquetRows,
          dataBlocked,
          truncated: parquetRows.length < parquetTotalRows,
          totalSize,
          totalRows: parquetTotalRows
        };
        return;
      }

      if (res.headers.get('X-Preview-Format') === 'csv') {
        const {
          headers: csvHeaders,
          rows: csvRows,
          totalRows: initialTotal
        } = await readCsvNdjsonStream(res);
        csvTotalRows = initialTotal;

        if (csvRows.length > 0 || infiniteScrollEnabled || !objectKey) {
          preview = {
            kind: 'csv_scroll',
            headers: csvHeaders,
            rows: csvRows,
            totalRows: initialTotal,
            truncated: initialTotal > csvRows.length,
            totalSize
          };
        } else {
          const data = await fetchCsvRows(0, 250).catch(() => []);
          preview = {
            kind: 'csv_scroll',
            headers: csvHeaders,
            rows: data,
            totalRows: csvTotalRows,
            truncated: csvTotalRows > data.length,
            totalSize
          };
        }
        return;
      }

      const text = await readTextSafely(res, key, contentType);
      if (text === null) {
        preview = { kind: 'fallback', contentType, isBinary: true };
        return;
      }

      if (
        contentType === 'text/csv' ||
        contentType === 'application/csv' ||
        contentType === 'application/vnd.ms-excel' ||
        contentType === 'text/tab-separated-values' ||
        key.toLowerCase().endsWith('.csv') ||
        key.toLowerCase().endsWith('.tsv')
      ) {
        preview = {
          kind: 'csv',
          text,
          truncated,
          totalSize,
          previewBytes,
          previewRows,
          previewColumns
        };
        return;
      }

      preview = { kind: 'text', text, contentType, truncated, totalSize, previewBytes };
      editorText = text;
      originalText = text;
    } catch {
      preview = { kind: 'error', message: m.storage_preview_error_desc() };
    }
  }

  function isTextContentType(contentType: string): boolean {
    if (contentType.startsWith('text/')) return true;
    if (contentType === 'application/json') return true;
    if (contentType === 'application/yaml') return true;
    if (contentType === 'application/xml') return true;
    if (contentType === 'application/csv') return true;
    if (contentType === 'application/x-ndjson') return true;
    return false;
  }

  async function readTextSafely(
    res: Response,
    key: string,
    contentType: string
  ): Promise<string | null> {
    try {
      const buf = await res.arrayBuffer();
      const bytes = new Uint8Array(buf);
      const truncated = res.headers.get('X-Preview-Truncated') === 'true';
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
        // If the content was truncated, the invalid bytes might be at the
        // truncation boundary (a multi-byte character cut in half). Decode
        // without fatal and strip trailing replacement characters.
        // Only do this for text-like content types — binary files should
        // fall through to the FallbackPreview.
        if (truncated && isTextContentType(contentType)) {
          const text = new TextDecoder('utf-8').decode(buf);
          return text.replace(/\uFFFD+$/, '');
        }

        // For CSV/TSV files try Windows-1252 — the default encoding used by
        // Excel on Windows when exporting to CSV.
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
              compressionUniform: true,
              hasOffsetIndex: false,
              hasColumnIndex: false,
              createdBy: null,
              version: 0,
              arrowSchema: null
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
    onColumn: ((name: string, values: unknown[]) => void) | undefined
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

  /** Read an NDJSON streaming response for CSV row data. */
  async function readCsvNdjsonStream(
    res: Response
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
          resultTotalRows = msg.tr ?? 0;
        } else if (msg.t === 'r') {
          rows = msg.v as unknown[][];
        } else if (msg.t === 'e') {
          throw new Error('Server error reading CSV data');
        }
      }
    }

    return { headers: resultHeaders, rows, totalRows: resultTotalRows };
  }

  async function triggerDownload() {
    if (!objectKey) return;

    try {
      const res = await storage.api.download({ bucket, key: objectKey });
      if (!res.ok) {
        addToast('error', m.storage_download_error_unknown());
        return;
      }
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const filename = objectKey.split('/').filter(Boolean).pop() ?? objectKey;
      const anchor = document.createElement('a');
      anchor.href = blobUrl;
      anchor.download = filename;
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 10_000);
    } catch (err) {
      if (err instanceof StorageError) {
        addToast('error', err.message);
      } else {
        addToast('error', m.storage_download_error_unknown());
      }
    }
  }

  async function handleSave() {
    if (!objectKey) return;
    if (isTooLargeToEdit()) {
      addToast('error', m.storage_editor_too_large({ limit: formatFileSize(maxEditableFileSize) }));
      return;
    }
    if (preview.kind !== 'text') return;

    saving = true;
    try {
      await storage.api.saveText({
        bucket,
        key: objectKey,
        body: editorText,
        originalSize: preview.totalSize,
        previewBytes: preview.previewBytes,
        contentType: preview.contentType
      });

      originalText = editorText;
      addToast('success', m.storage_editor_saved());
    } catch (err) {
      if (err instanceof StorageError) {
        if (err.code === 'not_connected') {
          addToast('error', m.storage_upload_error_not_connected());
        } else if (err.code === 'access_denied') {
          addToast('error', m.storage_upload_error_access_denied());
        } else {
          addToast('error', m.storage_editor_error());
        }
      } else {
        addToast('error', m.storage_editor_error());
      }
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

  // Sync parquetShowingRowsCount with the preview data
  $effect(() => {
    if (preview.kind === 'parquet') {
      parquetShowingRowsCount = preview.rows.length;
    }
  });

  // When infinite scroll is disabled and user clicks the data tab,
  // fetch the first page of parquet data on demand.
  $effect(() => {
    if (
      preview.kind === 'parquet' &&
      parquetTab === 'data' &&
      preview.rows.length === 0 &&
      !infiniteScrollEnabled &&
      !parquetDataLoading &&
      objectKey
    ) {
      parquetDataLoading = true;
      const hdrs = preview.headers;
      const rowCount = Math.min(250, preview.totalRows);
      const rows: unknown[][] = Array.from({ length: rowCount }, () =>
        new Array(hdrs.length).fill(undefined)
      );
      preview = { ...preview, rows: rows.map((r) => [...r]) };
      const colPos: Record<string, number> = {};
      fetchParquetRows(0, rowCount, (name, values) => {
        const colIdx = hdrs.indexOf(name);
        if (colIdx < 0) return;
        let pos = colPos[name] ?? 0;
        for (let i = 0; i < values.length; i++) {
          while (rows.length <= pos) {
            rows.push(new Array(hdrs.length).fill(undefined));
          }
          rows[pos][colIdx] = values[i];
          pos++;
        }
        colPos[name] = pos;
        if (preview.kind === 'parquet') {
          preview = { ...preview, rows: rows.map((r) => [...r]) };
        }
      })
        .then((finalRows) => {
          parquetDataLoading = false;
          if (preview.kind === 'parquet') {
            preview = {
              ...preview,
              rows: finalRows,
              truncated: finalRows.length < preview.totalRows
            };
          }
        })
        .catch(() => {
          parquetDataLoading = false;
        });
    }
  });

  function toggleMaximized() {
    maximized = !maximized;
  }

  // Function to fetch additional parquet chunks during infinite scroll
  async function fetchParquetRows(
    offset: number,
    limit: number,
    onColumn: ((name: string, values: unknown[]) => void) | undefined
  ): Promise<unknown[][]> {
    if (!objectKey) return [];

    const res = await storage.api.preview({
      bucket,
      key: objectKey,
      offset,
      limit,
      data: true
    });

    if (!res.ok) {
      throw new Error('Failed to fetch parquet chunk');
    }

    const { rows } = await readNdjsonStream(res, onColumn);
    return rows;
  }

  // Function to fetch additional CSV chunks during infinite scroll
  async function fetchCsvRows(offset: number, limit: number): Promise<unknown[][]> {
    if (!objectKey) return [];

    const res = await storage.api.preview({
      bucket,
      key: objectKey,
      offset,
      limit,
      data: true
    });

    if (!res.ok) {
      throw new Error('Failed to fetch CSV chunk');
    }

    const { rows, totalRows } = await readCsvNdjsonStream(res);
    csvTotalRows = totalRows;
    return rows;
  }
</script>

<Modal bind:open {closeguard} class="modal">
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
        {:else if preview.kind === 'csv_scroll'}
          <div class="mt-1 flex flex-wrap items-center gap-1">
            <span class="badge badge-neutral badge-sm font-mono"
              >{formatFileSize(preview.totalSize)}</span
            >
            {#if csvShowingRowsCount > 0}
              <span class="badge badge-soft badge-warning badge-sm">
                {csvTotalRows === csvShowingRowsCount
                  ? m.storage_preview_csv_rows_complete({
                      count: csvShowingRowsCount.toLocaleString(getLocale())
                    })
                  : m.storage_preview_csv_rows({
                      count: csvShowingRowsCount.toLocaleString(getLocale())
                    })}
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
            {:else if preview.truncated && parquetTab === 'data'}
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
        <TooltipTrigger text={m.storage_preview_restore()} orientation="down">
          <button
            class="btn btn-ghost btn-sm btn-square"
            onclick={toggleMaximized}
            aria-label={m.storage_preview_restore()}
          >
            <IconCloseFullscreen class="size-4" aria-hidden="true" />
          </button>
        </TooltipTrigger>
      {:else}
        <TooltipTrigger text={m.storage_preview_maximise()} orientation="down">
          <button
            class="btn btn-ghost btn-sm btn-square"
            onclick={toggleMaximized}
            aria-label={m.storage_preview_maximise()}
          >
            <IconOpenInFull class="size-4" aria-hidden="true" />
          </button>
        </TooltipTrigger>
      {/if}

      <TooltipTrigger text={m.storage_preview_close()} orientation="down">
        <button
          class="btn btn-ghost btn-sm btn-square"
          onclick={handleCloseClick}
          aria-label={m.storage_preview_close()}
        >
          <IconClose class="size-5" aria-hidden="true" />
        </button>
      </TooltipTrigger>
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

    <!-- Body -->
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
              fetchRows={infiniteScrollEnabled ? fetchParquetRows : undefined}
              bind:showingRowsCount={parquetShowingRowsCount}
              hidden={parquetTab !== 'data'}
            />
          {/if}
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
        <CsvPreview text={preview.text} />
      {:else if preview.kind === 'csv_scroll'}
        <CsvPreview
          headers={preview.headers}
          initialRows={preview.rows}
          totalRows={csvTotalRows}
          fetchRows={infiniteScrollEnabled ? fetchCsvRows : undefined}
          bind:showingRowsCount={csvShowingRowsCount}
        />
      {:else if preview.kind === 'image'}
        <div class="h-full overflow-scroll">
          <ImagePreview
            src={preview.blobUrl}
            name={filename}
            bind:naturalWidth={imageNaturalWidth}
            bind:naturalHeight={imageNaturalHeight}
          />
        </div>
      {:else if preview.kind === 'pdf'}
        <div class="h-full overflow-scroll">
          <PdfPreview src={preview.blobUrl} name={filename} />
        </div>
      {:else if preview.kind === 'fallback'}
        <div class="h-full overflow-scroll">
          <FallbackPreview
            contentType={preview.contentType}
            onDownload={triggerDownload}
            isBinary={preview.isBinary}
            imageTooLarge={preview.imageTooLarge}
          />
        </div>
      {/if}
    </div>

    {#if preview.kind === 'text' || preview.kind === 'csv' || preview.kind === 'csv_scroll' || preview.kind === 'parquet' || preview.kind === 'image' || preview.kind === 'pdf'}
      <div class="border-base-300 flex shrink-0 items-center justify-end gap-2 border-t px-5 py-2">
        {#if preview.kind === 'parquet' && preview.dataBlocked}
          <button type="button" class="btn btn-ghost btn-sm gap-1.5" onclick={triggerDownload}>
            <IconDownload class="size-4" aria-hidden="true" />
            {m.storage_preview_download_full()}
          </button>
        {:else if !archiveKey && (preview.kind === 'text' || preview.kind === 'csv' || preview.kind === 'csv_scroll') && preview.truncated}
          <button type="button" class="btn btn-ghost btn-sm gap-1.5" onclick={triggerDownload}>
            <IconDownload class="size-4" aria-hidden="true" />
            {m.storage_preview_download_full()}
          </button>
        {:else if !archiveKey && (preview.kind === 'image' || preview.kind === 'pdf')}
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
          <button
            type="button"
            class="btn btn-primary btn-sm gap-1.5"
            onclick={handleSaveAndClose}
            disabled={!dirty || saving}
          >
            <IconSave class="size-4" aria-hidden="true" />
            {m.storage_editor_save_and_close()}
          </button>
        {/if}
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
