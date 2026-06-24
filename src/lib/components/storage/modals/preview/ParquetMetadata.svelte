<script lang="ts">
  import IconSchema from 'virtual:icons/material-symbols/schema';
  import IconStorage from 'virtual:icons/material-symbols/database';
  import IconCompress from 'virtual:icons/material-symbols/compress';
  import Info from 'virtual:icons/material-symbols/info';
  import IconArrow from 'virtual:icons/material-symbols/arrow-circle-right';
  import IconUnfold from 'virtual:icons/material-symbols/unfold-more';
  import * as m from '$lib/paraglide/messages.js';
  import { getLocale } from '$lib/paraglide/runtime.js';
  import { formatFileSize } from '$lib/storage/utils.js';

  interface ColumnStats {
    nullCount: number | null;
    distinctCount: number | null;
    min: string | null;
    max: string | null;
  }

  interface ColumnInfo {
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

  let totalUncompressed = $derived(columnTypes.reduce((sum, col) => sum + col.uncompressedSize, 0));

  let showArrowSchema = $state(false);
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
      <table class="table-xs w-full table-fixed" aria-label={m.storage_preview_parquet_schema()}>
        <colgroup>
          <col class="w-8" />
          <col class="w-2/12" />
          <col class="w-1/12" />
          <col class="w-[10%]" />
          <col class="w-[28%]" />
          <col class="w-[30%]" />
        </colgroup>
        <thead>
          <tr class="text-base-content/50 text-left">
            <th>#</th>
            <th>{m.storage_preview_parquet_column()}</th>
            <th>{m.storage_preview_parquet_type()}</th>
            <th>{m.storage_preview_parquet_compression()}</th>
            <th>{m.storage_preview_parquet_size()}</th>
            <th>{m.storage_preview_parquet_statistics()}</th>
          </tr>
        </thead>
        <tbody>
          {#each columnTypes as col, i (col.name)}
            <tr class="hover:bg-base-200 transition-colors">
              <td class="text-base-content/30 font-mono text-xs">{i + 1}</td>
              <td class="max-w-40 truncate font-mono text-xs font-medium" title={col.name}>
                {col.name}
              </td>
              <td>
                <span class="badge badge-soft badge-sm font-mono">{col.type}</span>
              </td>
              <td>
                <span class="badge badge-soft badge-sm font-mono">{col.codec}</span>
              </td>
              <td class="min-w-36">
                {#if col.uncompressedSize > 0 || col.compressedSize > 0}
                  <div class="flex flex-col gap-0.5">
                    <div class="flex items-center gap-1 text-xs">
                      <span
                        class="tooltip tooltip-bottom"
                        data-tip="{m.storage_preview_parquet_compressed()}: {formatFileSize(
                          col.compressedSize
                        )} / {m.storage_preview_parquet_uncompressed()}: {formatFileSize(
                          col.uncompressedSize
                        )}"
                      >
                        <span class="text-base-content/70" aria-hidden="true">&#8595;</span>
                        <span class="font-mono">{formatFileSize(col.compressedSize)}</span>
                      </span>
                      {#if totalUncompressed > 0}
                        <span
                          class="tooltip tooltip-bottom text-base-content/40 text-[10px]"
                          data-tip="{Math.round(
                            (col.uncompressedSize / totalUncompressed) * 100
                          )}% of file uncompressed size"
                        >
                          ({Math.round((col.uncompressedSize / totalUncompressed) * 100)}%)
                        </span>
                      {/if}
                    </div>
                    <div
                      class="tooltip tooltip-bottom bg-base-300 h-1 w-full overflow-hidden rounded-full"
                      data-tip="{m.storage_preview_parquet_compressed()}: {formatFileSize(
                        col.compressedSize
                      )} / {m.storage_preview_parquet_uncompressed()}: {formatFileSize(
                        col.uncompressedSize
                      )}"
                      role="progressbar"
                      aria-valuenow={Math.round(
                        (col.compressedSize / Math.max(col.uncompressedSize, 1)) * 100
                      )}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label="{formatFileSize(col.compressedSize)} compressed / {formatFileSize(
                        col.uncompressedSize
                      )} uncompressed"
                    >
                      <div
                        class="bg-primary h-full rounded-full transition-all"
                        style="width: {Math.min(
                          100,
                          col.uncompressedSize > 0
                            ? Math.round((col.compressedSize / col.uncompressedSize) * 100)
                            : 100
                        )}%"
                      ></div>
                    </div>
                  </div>
                {:else}
                  <span class="text-base-content/30 text-xs">&mdash;</span>
                {/if}
              </td>
              <td class="min-w-32 overflow-hidden text-xs">
                {#if col.stats.min !== null || col.stats.max !== null || col.stats.nullCount !== null}
                  <div class="flex flex-col gap-0.5">
                    {#if col.stats.min !== null && col.stats.max !== null}
                      <span
                        class="truncate font-mono text-[10px]"
                        title="{col.stats.min} .. {col.stats.max}"
                      >
                        {col.stats.min} .. {col.stats.max}
                      </span>
                    {/if}
                    <span class="text-base-content/50">
                      {#if col.stats.nullCount !== null}
                        null={col.stats.nullCount.toLocaleString(getLocale())}
                      {/if}
                      {#if col.stats.distinctCount !== null}
                        {col.stats.nullCount !== null
                          ? ' '
                          : ''}dist={col.stats.distinctCount.toLocaleString(getLocale())}
                      {/if}
                    </span>
                  </div>
                {:else}
                  <span class="text-base-content/30 italic"
                    >{m.storage_preview_parquet_not_stored()}</span
                  >
                {/if}
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
        <dt class="text-base-content/50">{m.storage_preview_parquet_compression()}</dt>
        <dd class="flex flex-wrap items-center gap-1">
          {#if metadata.compressionCodecs.length === 0}
            <span class="text-base-content/50 text-xs italic"
              >{m.storage_preview_parquet_none()}</span
            >
          {:else}
            {#each metadata.compressionCodecs as codec (codec)}
              <span class="badge badge-soft badge-sm font-mono">{codec}</span>
            {/each}
            {#if metadata.compressionUniform && metadata.compressionCodecs.length === 1}
              <span class="text-base-content/40 text-[10px]"
                >({m.storage_preview_parquet_uniform()})</span
              >
            {/if}
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

  <!-- Arrow Schema -->
  {#if metadata.arrowSchema}
    <section aria-label={m.storage_preview_parquet_arrow_schema()}>
      <h3 class="text-base-content mb-3 flex items-center gap-2 text-sm font-semibold">
        <IconArrow class="size-4" aria-hidden="true" />
        {m.storage_preview_parquet_arrow_schema()}
      </h3>
      <div class="text-base-content/70 text-sm">
        <span class="italic">
          {m.storage_preview_parquet_arrow_schema_present({ size: metadata.arrowSchema.length })}
        </span>
        <button
          class="btn btn-ghost btn-xs gap-1"
          onclick={() => (showArrowSchema = !showArrowSchema)}
          aria-expanded={showArrowSchema}
        >
          <IconUnfold class="size-3" aria-hidden="true" />
          {showArrowSchema ? 'Hide' : 'Show'}
        </button>
      </div>
      {#if showArrowSchema}
        <pre
          class="bg-base-200 text-base-content/80 mt-1 overflow-x-auto rounded-md p-3 font-mono text-xs leading-relaxed">{metadata.arrowSchema}</pre>
      {/if}
    </section>
  {/if}

  <!-- Row Groups Detail -->
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
