<script lang="ts">
  import * as m from '$lib/paraglide/messages.js';

  const MAX_ROWS = 250;

  interface Props {
    text: string;
  }

  let { text }: Props = $props();

  const { headers, rows } = $derived.by(() => {
    // Split into lines, strip trailing newline
    const lines = text.split('\n').filter((l) => l.trim() !== '');
    if (lines.length === 0) return { headers: [], rows: [] };

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
    const rws = dataLines.slice(0, MAX_ROWS).map(parseLine);
    return { headers: hdrs, rows: rws };
  });

  const truncated = $derived.by(() => {
    const lines = text.split('\n').filter((l) => l.trim() !== '');
    return lines.length > MAX_ROWS + 1;
  });
</script>

<div>
  {#if headers.length === 0}
    <p class="text-base-content/50 p-4 text-sm italic">{m.storage_bucket_empty()}</p>
  {:else}
    <table class="table-xs table min-w-max" aria-label="CSV preview">
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
