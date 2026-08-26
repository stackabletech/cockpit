<script lang="ts">
  import { Handle, Position } from '@xyflow/svelte';
  import * as m from '$lib/paraglide/messages.js';
  import {
    AGGREGATE_FUNCTIONS,
    JOIN_TYPES,
    WHERE_OPERATORS,
    type AggregateFn,
    type CommandType,
    type JoinType
  } from '$lib/sql-diagram/types.js';

  export interface ConnectedColumn {
    edgeId: string;
    table: string;
    column: string;
  }

  export interface CommandNodeData extends Record<string, unknown> {
    command: CommandType;
    connectedColumns: ConnectedColumn[];
    whereClauses: {
      edgeId: string;
      table: string;
      column: string;
      operator: string;
      value: string;
    }[];
    orderClauses: { edgeId: string; table: string; column: string; direction: 'ASC' | 'DESC' }[];
    /** Optional aggregate per connected column (GROUP BY only). */
    aggregateClauses?: { edgeId: string; fn: AggregateFn }[];
    limitValue: number;
    joinType?: JoinType;
    onWhereUpdate: (edgeId: string, field: 'operator' | 'value', val: string) => void;
    onOrderUpdate: (edgeId: string, direction: 'ASC' | 'DESC') => void;
    onLimitUpdate: (val: number) => void;
    onJoinUpdate: (nodeId: string, joinType: JoinType) => void;
    onAggregateUpdate?: (edgeId: string, fn: AggregateFn) => void;
  }

  interface Props {
    id: string;
    data: CommandNodeData;
    selected?: boolean;
  }

  let { id, data, selected = false }: Props = $props();

  const commandBorder: Record<CommandType, string> = {
    WHERE: 'border-warning/50',
    'ORDER BY': 'border-secondary/50',
    LIMIT: 'border-info/50',
    'GROUP BY': 'border-accent/50',
    JOIN: 'border-success/50'
  };

  const commandHeader: Record<CommandType, string> = {
    WHERE: 'bg-warning/15 text-warning',
    'ORDER BY': 'bg-secondary/15 text-secondary',
    LIMIT: 'bg-info/15 text-info',
    'GROUP BY': 'bg-accent/15 text-accent',
    JOIN: 'bg-success/15 text-success'
  };

  const commandHandle: Record<CommandType, string> = {
    WHERE: '!border-warning',
    'ORDER BY': '!border-secondary',
    LIMIT: '!border-info',
    'GROUP BY': '!border-accent',
    JOIN: '!border-success'
  };

  const colLabel = (c: ConnectedColumn) => `${c.table}.${c.column}`;
</script>

<div
  class="bg-base-100 min-w-52 overflow-visible rounded-lg border shadow-lg transition-shadow
	       {selected ? 'shadow-primary/30 ring-primary/40 ring-1' : 'shadow-black/20'}
	       {commandBorder[data.command]}"
>
  <!-- Command header -->
  <div
    class="relative flex items-center gap-2 rounded-t-lg border-b border-current/20 px-3 py-2 {commandHeader[
      data.command
    ]}"
  >    <!-- Input handle (left) – accepts column connections and cmd→cmd chains.
		     JOIN has two dedicated entrypoints (A here, B in the footer). -->
    {#if data.command === 'JOIN'}
      <Handle
        type="target"
        position={Position.Left}
        id="join-input-a"
        class="!bg-base-100 !h-3 !w-3 !rounded-full !border-2 {commandHandle[data.command]}"
      />
      <span class="text-[9px] leading-none font-bold opacity-60">A</span>
    {:else}
      <Handle
        type="target"
        position={Position.Left}
        id="cmd-input"
        class="!bg-base-100 !h-3 !w-3 !rounded-full !border-2 {commandHandle[data.command]}"
      />
    {/if}

    <span class="flex-1 text-xs font-black tracking-widest uppercase">{data.command}</span>

    <!-- Output handle (right) – chain to the next command node (not for JOIN) -->
    {#if data.command !== 'JOIN'}
      <Handle
        type="source"
        position={Position.Right}
        id="cmd-output"
        class="!bg-base-100 !h-3 !w-3 !rounded-full !border-2 {commandHandle[data.command]}"
      />
    {/if}
  </div>

  <!-- Body -->
  <div class="text-base-content space-y-1.5 px-3 py-2 text-xs">
    {#if data.command === 'JOIN'}
      <div class="flex items-center gap-2">
        <span class="text-base-content/60 shrink-0">{m.sql_diagram_join_type()}</span>
        <select
          class="select select-xs border-base-300 bg-base-100 w-full flex-1 border font-mono text-[10px]"
          aria-label={m.sql_diagram_join_type()}
          value={data.joinType ?? 'INNER'}
          onchange={(e) => data.onJoinUpdate(id, (e.target as HTMLSelectElement).value as JoinType)}
        >
          {#each JOIN_TYPES as jt (jt)}
            <option value={jt}>{jt} JOIN</option>
          {/each}
        </select>
      </div>
      {#if data.connectedColumns[0] && data.connectedColumns[1]}
        <div class="bg-base-200/60 space-y-0.5 rounded px-1.5 py-1">
          <div class="flex items-center gap-1.5">
            <span class="shrink-0 text-[9px] font-bold opacity-70">A</span>
            <span class="truncate font-mono text-[11px]">{colLabel(data.connectedColumns[0])}</span>
          </div>
          <div class="text-base-content/40 px-2 text-[10px] leading-none">=</div>
          <div class="flex items-center gap-1.5">
            <span class="shrink-0 text-[9px] font-bold opacity-70">B</span>
            <span class="truncate font-mono text-[11px]">{colLabel(data.connectedColumns[1])}</span>
          </div>
        </div>
      {:else}
        <p class="text-base-content/40 text-[11px] italic">{m.sql_diagram_join_prompt()}</p>
      {/if}
    {:else if data.command === 'WHERE'}
      {#if data.whereClauses.length === 0}
        <p class="text-base-content/40 text-[11px] italic">{m.sql_diagram_connect_prompt()}</p>
      {:else}
        {#each data.whereClauses as clause (clause.edgeId)}
          <div class="bg-base-200/60 space-y-1 rounded p-1.5">
            <span class="block truncate font-mono text-[11px]">{clause.table}.{clause.column}</span>
            <div class="flex items-center gap-1">
              <select
                class="select select-xs border-base-300 bg-base-100 w-[72px] flex-none border font-mono text-[10px]"
                aria-label={m.sql_diagram_operator_label({
                  column: `${clause.table}.${clause.column}`
                })}
                value={clause.operator}
                onchange={(e) =>
                  data.onWhereUpdate(
                    clause.edgeId,
                    'operator',
                    (e.target as HTMLSelectElement).value
                  )}
              >
                {#each WHERE_OPERATORS as op (op)}
                  <option value={op}>{op}</option>
                {/each}
              </select>
              <input
                type="text"
                class="input input-xs border-base-300 bg-base-100 min-w-0 flex-1 border font-mono text-[11px]"
                placeholder={m.sql_diagram_value_placeholder()}
                aria-label={m.sql_diagram_value_label({
                  column: `${clause.table}.${clause.column}`
                })}
                value={clause.value}
                oninput={(e) =>
                  data.onWhereUpdate(clause.edgeId, 'value', (e.target as HTMLInputElement).value)}
              />
            </div>
          </div>
        {/each}
      {/if}
    {:else if data.command === 'ORDER BY'}
      {#if data.orderClauses.length === 0}
        <p class="text-base-content/40 text-[11px] italic">{m.sql_diagram_connect_prompt()}</p>
      {:else}
        {#each data.orderClauses as clause (clause.edgeId)}
          <div class="bg-base-200/60 flex items-center gap-2 rounded px-1.5 py-1">
            <span class="flex-1 truncate font-mono text-[11px]">{clause.table}.{clause.column}</span
            >
            <div class="join">
              <button
                type="button"
                class="btn join-item btn-xs px-1.5 {clause.direction === 'ASC'
                  ? 'btn-primary'
                  : 'btn-ghost border-base-300 border'}"
                onclick={() => data.onOrderUpdate(clause.edgeId, 'ASC')}
              >
                ASC
              </button>
              <button
                type="button"
                class="btn join-item btn-xs px-1.5 {clause.direction === 'DESC'
                  ? 'btn-primary'
                  : 'btn-ghost border-base-300 border'}"
                onclick={() => data.onOrderUpdate(clause.edgeId, 'DESC')}
              >
                DESC
              </button>
            </div>
          </div>
        {/each}
      {/if}
    {:else if data.command === 'GROUP BY'}
      {#if data.connectedColumns.length === 0}
        <p class="text-base-content/40 text-[11px] italic">{m.sql_diagram_connect_prompt()}</p>
      {:else}
        {#each data.connectedColumns as col (col.edgeId)}
          {@const agg = data.aggregateClauses?.find((a) => a.edgeId === col.edgeId)?.fn ?? 'NONE'}
          <div class="bg-base-200/60 flex items-center gap-1.5 rounded px-1.5 py-1">
            <span class="flex-1 truncate font-mono text-[11px]" title={colLabel(col)}
              >{colLabel(col)}</span
            >
            <select
              class="select select-xs border-base-300 bg-base-100 w-20 flex-none border font-mono text-[10px]"
              aria-label={m.sql_diagram_aggregate_aria({ column: colLabel(col) })}
              value={agg}
              onchange={(e) =>
                data.onAggregateUpdate?.(
                  col.edgeId,
                  (e.target as HTMLSelectElement).value as AggregateFn
                )}
            >
              <option value="NONE">{m.sql_diagram_aggregate_none()}</option>
              {#each AGGREGATE_FUNCTIONS as fn (fn)}
                <option value={fn}>{fn}</option>
              {/each}
            </select>
          </div>
        {/each}
        <p class="text-base-content/40 text-[10px] italic">
          {m.sql_diagram_group_hint()}
        </p>
      {/if}
    {:else if data.command === 'LIMIT'}
      <div class="flex items-center gap-2">
        <label class="text-base-content/60 shrink-0" for="limit-{id}"
          >{m.sql_diagram_limit_rows()}</label
        >
        <input
          id="limit-{id}"
          type="number"
          min="1"
          max="10000"
          class="input input-xs border-base-300 bg-base-100 w-24 border font-mono text-[11px]"
          value={data.limitValue}
          oninput={(e) => data.onLimitUpdate(parseInt((e.target as HTMLInputElement).value) || 0)}
        />
      </div>
    {/if}
  </div>

  <!-- JOIN footer with second entrypoint (B) -->
  {#if data.command === 'JOIN'}
    <div
      class="bg-success/10 relative flex items-center gap-2 rounded-b-lg border-t border-current/20 px-3 py-1"
    >
      <Handle
        type="target"
        position={Position.Left}
        id="join-input-b"
        class="!bg-base-100 !h-3 !w-3 !rounded-full !border-2 {commandHandle[data.command]}"
      />
      <span class="text-[9px] font-bold opacity-70">B</span>
    </div>
  {/if}
</div>
