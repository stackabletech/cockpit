<script lang="ts">
  import * as m from '$lib/paraglide/messages.js';

  interface Props {
    text: string;
    maxRows?: number;
  }

  let { text, maxRows = 250 }: Props = $props();

  const maxColumns = 50; // TODO: magic number

  const { headers, rows, displayHeaders, extraColumns } = $derived.by(() => {
    // Split into lines, strip trailing newline
    const lines = text.split('\n').filter((l) => l.trim() !== '');
    if (lines.length === 0) return { headers: [], rows: [], displayHeaders: [], extraColumns: 0 };

    // Simple CSV parse: handle quoted fields
    function parseLine(line: string): string[] {
      const result: string[] = [];
      let current = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          if (inQuotes && line[i + 1] === '"') {
            current += '"';
            i++;
          } else {
            inQuotes = !inQuotes;
          }
        } else if (ch === ',' && !inQuotes) {
          result.push(current);
          current = '';
        } else {
          current += ch;
        }
      }
      result.push(current);
      return result;
    }

    const [headerLine, ...dataLines] = lines;
    const hdrs = parseLine(headerLine);
    const rws = dataLines.slice(0, maxRows).map(parseLine);
    const display = hdrs.slice(0, maxColumns);
    const extra = Math.max(0, hdrs.length - maxColumns);
    return { headers: hdrs, rows: rws, displayHeaders: display, extraColumns: extra };
  });

  const truncated = $derived.by(() => {
    const lines = text.split('\n').filter((l) => l.trim() !== '');
    return lines.length > maxRows + 1;
  });
</script>

<div>
  {#if headers.length === 0}
    <p class="text-base-content/50 p-4 text-sm italic">{m.storage_bucket_empty()}</p>
  {:else}
    <table class="table-xs table min-w-max" aria-label="CSV preview">
      <thead>
        <tr class="bg-base-200 text-base-content/60 sticky top-0 z-10 text-xs">
          {#each displayHeaders as header, i (i)}
            <th class="font-semibold whitespace-nowrap">{header}</th>
          {/each}
          {#if extraColumns > 0}
            <th class="text-base-content/40 font-semibold whitespace-nowrap italic">
              {m.storage_preview_csv_columns({ count: extraColumns })}
            </th>
          {/if}
        </tr>
      </thead>
      <tbody>
        {#each rows as row, i (i)}
          <tr class="hover:bg-base-200 transition-colors">
            <!--eslint-disable-next-line @typescript-eslint/no-unused-vars-->
            {#each displayHeaders as _h, j (j)}
              <td class="text-base-content/80 max-w-xs truncate text-xs">{row[j] ?? ''}</td>
            {/each}
            {#if extraColumns > 0}
              <td class="text-base-content/30 max-w-xs truncate text-xs italic" />
            {/if}
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
