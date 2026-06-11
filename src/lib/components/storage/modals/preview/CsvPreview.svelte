<script lang="ts">
  import Papa from 'papaparse';
  import * as m from '$lib/paraglide/messages.js';

  const MAX_ROWS = 250;

  interface Props {
    text: string;
  }

  let { text }: Props = $props();

  const { headers, rows } = $derived.by(() => {
    const result = Papa.parse(text, {
      preview: MAX_ROWS + 1,
      header: false,
      skipEmptyLines: true
    });
    if (result.data.length === 0) return { headers: [], rows: [] };
    const [hdrs, ...data] = result.data as string[][];
    return { headers: hdrs, rows: data };
  });

  const truncated = $derived.by(() => {
    const result = Papa.parse(text, { skipEmptyLines: true });
    return result.data.length > MAX_ROWS + 1;
  });

  const uid = $props.id();
</script>

<div>
  {#if headers.length === 0}
    <p class="text-base-content/50 p-4 text-sm italic">{m.storage_bucket_empty()}</p>
  {:else}
    <table class="table-xs table min-w-max" aria-label="CSV preview">
      <thead>
        <tr class="bg-base-200 text-base-content/60 sticky top-0 z-10 text-xs">
          <th class="text-base-content/30 w-10 text-right font-normal" id="{uid}-line-hdr"></th>
          {#each headers as header (header)}
            <th class="font-semibold whitespace-nowrap">{header}</th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each rows as row, i (i)}
          <tr class="hover:bg-base-200 transition-colors">
            <td class="text-base-content/30 w-10 pr-1 text-right text-xs select-none"
              >{(i + 1).toLocaleString()}</td
            >
            <!--eslint-disable-next-line @typescript-eslint/no-unused-vars-->
            {#each headers as _h, j (j)}
              <td class="text-base-content/80 max-w-xs truncate text-xs">{row[j] ?? ''}</td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
    {#if truncated}
      <p class="text-base-content/50 px-4 py-2 text-xs italic">
        {m.storage_preview_csv_rows({ count: rows.length })}
      </p>
    {/if}
  {/if}
</div>
