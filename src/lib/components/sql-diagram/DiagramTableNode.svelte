<script lang="ts">
  import { Handle, Position } from '@xyflow/svelte';
  import * as m from '$lib/paraglide/messages.js';
  import type { DiagramColumn, TableColumnClauses } from '$lib/sql-diagram/types.js';

  export interface TableNodeData extends Record<string, unknown> {
    tableName: string;
    columns: DiagramColumn[];
    selectedColumns: string[];
    columnClauses: Record<string, TableColumnClauses>;
    onToggleColumn: (table: string, column: string, checked: boolean) => void;
    onToggleAllColumns: (table: string, checked: boolean) => void;
    onColumnContextMenu: (table: string, column: string, e: MouseEvent) => void;
    onGetOrderRank?: (table: string, column: string) => number | null;
  }

  interface Props {
    data: TableNodeData;
    selected?: boolean;
  }

  let { data, selected = false }: Props = $props();

  const allSelected = $derived(
    data.columns.length > 0 && data.selectedColumns.length === data.columns.length
  );
  const someSelected = $derived(data.selectedColumns.length > 0 && !allSelected);

  let allCheckbox = $state<HTMLInputElement | null>(null);
  $effect(() => {
    if (allCheckbox) allCheckbox.indeterminate = someSelected;
  });

  /** Semantic colour per data type family so light/dark themes both work. */
  function typeClass(dataType: string): string {
    const t = dataType.toUpperCase();
    if (/INT|BIGINT|SMALLINT|TINYINT|DOUBLE|REAL|DECIMAL|FLOAT/.test(t)) return 'text-info';
    if (/CHAR|TEXT|STRING|JSON|UUID/.test(t)) return 'text-success';
    if (/DATE|TIME/.test(t)) return 'text-secondary';
    return 'text-base-content/50';
  }
</script>

<div
  class="bg-base-100 border-base-300 min-w-52 overflow-hidden rounded-lg border shadow-lg transition-shadow
	       {selected ? 'border-primary shadow-primary/30' : ''}"
>
  <!-- Table header with select-all checkbox -->
  <div class="border-base-300 bg-primary/15 flex items-center gap-2 border-b px-3 py-2">
    <input
      type="checkbox"
      bind:this={allCheckbox}
      class="checkbox checkbox-primary checkbox-xs nodrag"
      checked={allSelected}
      aria-label={m.sql_diagram_select_all_columns({ table: data.tableName })}
      onclick={(e) => e.stopPropagation()}
      onchange={(e) =>
        data.onToggleAllColumns(data.tableName, (e.target as HTMLInputElement).checked)}
    />
    <span class="text-base-content text-sm font-bold">{data.tableName}</span>
  </div>

  <!-- Columns -->
  <div class="divide-base-200 divide-y">
    {#each data.columns as col (col.name)}
      {@const clauses = data.columnClauses[col.name]}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="group hover:bg-base-200/50 relative flex items-center px-2 py-1"
        oncontextmenu={(e) => data.onColumnContextMenu(data.tableName, col.name, e)}
      >
        <!-- Target handle (left) – receives join edges -->
        <Handle
          type="target"
          position={Position.Left}
          id="{data.tableName}.{col.name}"
          class="!border-base-content/30 !bg-base-100 !h-2.5 !w-2.5 !rounded-full !border-2 opacity-0 group-hover:opacity-100"
        />

        <!-- Source handle (left) – used when the target sits left of this node -->
        <Handle
          type="source"
          position={Position.Left}
          id="{data.tableName}.{col.name}|l"
          class="!border-accent !bg-base-100 !h-2.5 !w-2.5 !rounded-full !border-2 opacity-0 group-hover:opacity-100"
        />

        <!-- Source handle (right) -->
        <Handle
          type="source"
          position={Position.Right}
          id="{data.tableName}.{col.name}"
          class="!border-accent !bg-base-100 !h-2.5 !w-2.5 !rounded-full !border-2 opacity-0 group-hover:opacity-100"
        />

        <!-- Target handle (right) – used when the origin sits right of this node -->
        <Handle
          type="target"
          position={Position.Right}
          id="{data.tableName}.{col.name}|r"
          class="!border-base-content/30 !bg-base-100 !h-2.5 !w-2.5 !rounded-full !border-2 opacity-0 group-hover:opacity-100"
        />

        <label class="flex flex-1 cursor-pointer items-start gap-1.5">
          <input
            type="checkbox"
            class="checkbox checkbox-primary checkbox-xs nodrag mt-0.5"
            checked={data.selectedColumns.includes(col.name)}
            aria-label={m.sql_diagram_select_column({
              table: data.tableName,
              column: col.name
            })}
            onclick={(e) => e.stopPropagation()}
            onchange={(e) =>
              data.onToggleColumn(data.tableName, col.name, (e.target as HTMLInputElement).checked)}
          />

          <span class="min-w-0 flex-1 pt-px">
            <span class="flex items-center gap-1.5">
              <span class="text-base-content truncate text-xs font-medium">{col.name}</span>
              <span class="ml-auto shrink-0 pl-1 font-mono text-[10px] {typeClass(col.dataType)}"
                >{col.dataType}</span
              >
            </span>

            <!-- Inline WHERE / ORDER BY display -->
            {#if clauses?.where?.length || clauses?.orderBy}
              <span class="mt-0.5 flex flex-wrap items-center gap-1">
                {#each clauses.where ?? [] as w (w.operator + w.value)}
                  <span
                    class="bg-warning/15 text-warning inline-flex items-center rounded px-1 font-mono text-[9px] leading-relaxed"
                  >
                    {w.operator}
                    {w.value}
                  </span>
                {/each}
                {#if clauses.orderBy}
                  {@const rank = data.onGetOrderRank?.(data.tableName, col.name) ?? null}
                  <span
                    class="bg-secondary/15 text-secondary inline-flex items-center rounded px-1 font-mono text-[9px] leading-relaxed"
                  >
                    {rank ? `${rank}. ` : ''}ORDER BY {clauses.orderBy.direction}
                  </span>
                {/if}
              </span>
            {/if}
          </span>
        </label>
      </div>
    {/each}
  </div>
</div>
