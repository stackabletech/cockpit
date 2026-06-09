<script lang="ts">
  import * as m from '$lib/paraglide/messages.js';

  interface Props {
    headers: string[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rows: any[][];
    totalRows?: number;
  }

  let { headers, rows, totalRows = 0 }: Props = $props();

  const isTruncated = $derived(totalRows > rows.length);
</script>

<div>
  {#if headers.length === 0}
    <p class="text-base-content/50 p-4 text-sm italic">{m.storage_bucket_empty()}</p>
  {:else}
    <div class="overflow-x-auto">
      <table class="table-xs table min-w-max" aria-label="Parquet preview">
        <thead>
          <tr class="bg-base-200 text-base-content/60 sticky top-0 z-10 text-xs">
            {#each headers as header (header)}
              <th class="font-semibold whitespace-nowrap">{header}</th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each rows as row, i (i)}
            <tr class="hover:bg-base-200 transition-colors">
              <!--eslint-disable-next-line @typescript-eslint/no-unused-vars-->
              {#each headers as _h, j (j)}
                <td class="text-base-content/80 max-w-xs truncate text-xs">
                  {row[j] !== null && row[j] !== undefined ? String(row[j]) : ''}
                </td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    {#if isTruncated}
      <p class="text-base-content/50 px-4 py-2 text-xs italic">
        <!-- Assuming you add a Parquet equivalent to your paraglide translations -->
        {m.storage_preview_parquet_rows
          ? m.storage_preview_parquet_rows({ count: rows.length, total: totalRows })
          : `Previewing first ${rows.length} rows of ${totalRows.toLocaleString()}`}
      </p>
    {/if}
  {/if}
</div>
