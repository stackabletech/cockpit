<script lang="ts">
  import IconSchema from 'virtual:icons/material-symbols/schema';
  import IconStorage from 'virtual:icons/material-symbols/database';
  import IconCompress from 'virtual:icons/material-symbols/compress';
  import Info from 'virtual:icons/material-symbols/info';
  import * as m from '$lib/paraglide/messages.js';
  import { getLocale } from '$lib/paraglide/runtime.js';
  import { formatFileSize } from '$lib/storage/utils.js';

  interface ColumnInfo {
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

  interface Props {
    headers: string[];
    columnTypes: ColumnInfo[];
    totalRows: number;
    totalSize: number;
    metadata: ParquetFileMeta;
  }

  let { headers, columnTypes, totalRows, totalSize, metadata }: Props = $props();

  let hasOffsetBadge = $derived(
    metadata.hasOffsetIndex ? 'badge-success' : 'badge-soft badge-warning'
  );
  let hasColumnBadge = $derived(
    metadata.hasColumnIndex ? 'badge-success' : 'badge-soft badge-warning'
  );
</script>

<div class="flex h-full flex-col gap-4 overflow-auto p-4">
  <!-- File Overview -->
  <section aria-label={m.storage_preview_parquet_overview()}>
    <h3 class="text-base-content mb-3 flex items-center gap-2 text-sm font-semibold">
      <Info class="size-4" aria-hidden="true" />
      {m.storage_preview_parquet_overview()}
    </h3>
    <dl class="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
      <div>
        <dt class="text-base-content/50">{m.storage_preview_parquet_file_size()}</dt>
        <dd class="text-base-content font-mono font-medium">{formatFileSize(totalSize)}</dd>
      </div>
      <div>
        <dt class="text-base-content/50">{m.storage_preview_parquet_total_rows()}</dt>
        <dd class="text-base-content font-mono font-medium">
          {totalRows.toLocaleString(getLocale())}
        </dd>
      </div>
      <div>
        <dt class="text-base-content/50">{m.storage_preview_parquet_total_columns()}</dt>
        <dd class="text-base-content font-mono font-medium">{headers.length}</dd>
      </div>
      <div>
        <dt class="text-base-content/50">{m.storage_preview_parquet_version()}</dt>
        <dd class="text-base-content font-mono font-medium">v{metadata.version}</dd>
      </div>
      {#if metadata.createdBy}
        <div class="col-span-2 sm:col-span-2">
          <dt class="text-base-content/50">{m.storage_preview_parquet_created_by()}</dt>
          <dd class="text-base-content truncate font-mono text-xs">{metadata.createdBy}</dd>
        </div>
      {/if}
    </dl>
  </section>

  <!-- Schema -->
  <section aria-label={m.storage_preview_parquet_schema()}>
    <h3 class="text-base-content mb-3 flex items-center gap-2 text-sm font-semibold">
      <IconSchema class="size-4" aria-hidden="true" />
      {m.storage_preview_parquet_schema()}
    </h3>
    <div class="overflow-x-auto">
      <table class="table-xs table" aria-label={m.storage_preview_parquet_schema()}>
        <thead>
          <tr class="text-base-content/50">
            <th>#</th>
            <th>{m.storage_preview_parquet_column()}</th>
            <th>{m.storage_preview_parquet_type()}</th>
          </tr>
        </thead>
        <tbody>
          {#each columnTypes as col, i (col.name)}
            <tr class="hover:bg-base-200 transition-colors">
              <td class="text-base-content/30 font-mono text-xs">{i + 1}</td>
              <td class="font-mono text-xs font-medium">{col.name}</td>
              <td>
                <span class="badge badge-soft badge-sm font-mono">{col.type}</span>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </section>

  <!-- Compression & Indexes -->
  <section aria-label={m.storage_preview_parquet_compression_indexes()}>
    <h3 class="text-base-content mb-3 flex items-center gap-2 text-sm font-semibold">
      <IconCompress class="size-4" aria-hidden="true" />
      {m.storage_preview_parquet_compression_indexes()}
    </h3>
    <dl class="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
      <div>
        <dt class="text-base-content/50">{m.storage_preview_parquet_row_groups()}</dt>
        <dd class="text-base-content font-mono font-medium">{metadata.rowGroups}</dd>
      </div>
      <div>
        <dt class="text-base-content/50">{m.storage_preview_parquet_compression_indexes()}</dt>
        <dd class="flex flex-wrap gap-1">
          {#if metadata.compressionCodecs.length === 0}
            <span class="text-base-content/50 text-xs italic"
              >{m.storage_preview_parquet_none()}</span
            >
          {:else}
            {#each metadata.compressionCodecs as codec (codec)}
              <span class="badge badge-soft badge-sm font-mono">{codec}</span>
            {/each}
          {/if}
        </dd>
      </div>
      <div>
        <dt class="text-base-content/50">{m.storage_preview_parquet_offset_index()}</dt>
        <dd>
          <span class="badge {hasOffsetBadge} badge-sm">
            {metadata.hasOffsetIndex
              ? m.storage_preview_parquet_available()
              : m.storage_preview_parquet_missing()}
          </span>
        </dd>
      </div>
      <div>
        <dt class="text-base-content/50">{m.storage_preview_parquet_column_index()}</dt>
        <dd>
          <span class="badge {hasColumnBadge} badge-sm">
            {metadata.hasColumnIndex
              ? m.storage_preview_parquet_available()
              : m.storage_preview_parquet_missing()}
          </span>
        </dd>
      </div>
    </dl>
  </section>

  <!-- Row Groups Detail (count only — per-group details are not surfaced by the server) -->
  {#if metadata.rowGroups > 0}
    <section aria-label={m.storage_preview_parquet_row_groups()}>
      <h3 class="text-base-content mb-3 flex items-center gap-2 text-sm font-semibold">
        <IconStorage class="size-4" aria-hidden="true" />
        {m.storage_preview_parquet_row_groups()}
      </h3>
      <dl class="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
        <div>
          <dt class="text-base-content/50">{m.storage_preview_parquet_row_groups()}</dt>
          <dd class="text-base-content font-mono font-medium">{metadata.rowGroups}</dd>
        </div>
      </dl>
    </section>
  {/if}
</div>
