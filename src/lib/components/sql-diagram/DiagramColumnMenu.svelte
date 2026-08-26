<script lang="ts">
  import * as m from '$lib/paraglide/messages.js';
  import type { SortDirection } from '$lib/sql-diagram/types.js';

  interface Props {
    x: number;
    y: number;
    tableName: string;
    columnName: string;
    hasWhere: boolean;
    orderBy?: SortDirection;
    onwhere: () => void;
    onorder: (direction: SortDirection) => void;
    onclearwhere: () => void;
    onclearorder: () => void;
    onclose: () => void;
  }

  let {
    x,
    y,
    tableName,
    columnName,
    hasWhere,
    orderBy,
    onwhere,
    onorder,
    onclearwhere,
    onclearorder,
    onclose
  }: Props = $props();

  function clamp(rawX: number, rawY: number) {
    const left = Math.min(rawX, window.innerWidth - 230);
    const top = Math.min(rawY, window.innerHeight - 300);
    return `left:${left}px;top:${top}px`;
  }

  function run(action: () => void) {
    action();
    onclose();
  }
</script>

<svelte:window onclick={onclose} />

<!-- Click-away backdrop -->
<button
  type="button"
  class="fixed inset-0 z-40 cursor-default"
  tabindex="-1"
  aria-label={m.sql_diagram_cancel()}
  onclick={onclose}
></button>

<div
  class="border-base-300 bg-base-100 fixed z-50 overflow-hidden rounded-xl border shadow-2xl"
  style={clamp(x, y)}
>
  <div class="border-base-200 border-b px-3 py-2">
    <p class="text-base-content/40 text-[11px] font-semibold tracking-widest uppercase">
      <span class="text-base-content/60 font-mono normal-case">{tableName}.{columnName}</span>
    </p>
  </div>
  <ul class="space-y-0.5 p-1.5">
    <li>
      <button
        type="button"
        class="hover:bg-base-200 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors"
        onclick={() => run(onwhere)}
      >
        <div>
          <p class="text-warning text-sm font-semibold">
            {hasWhere ? m.sql_diagram_menu_edit_where() : m.sql_diagram_menu_add_where()}
          </p>
          <p class="text-base-content/50 text-[11px]">{m.sql_diagram_cmd_where_desc()}</p>
        </div>
      </button>
    </li>
    {#if hasWhere}
      <li>
        <button
          type="button"
          class="hover:bg-base-200 flex w-full items-center gap-3 rounded-lg px-3 py-1.5 text-left transition-colors"
          onclick={() => run(onclearwhere)}
        >
          <span class="text-error w-4 shrink-0 text-center font-mono text-sm">×</span>
          <p class="text-error text-xs">{m.sql_diagram_menu_remove_where()}</p>
        </button>
      </li>
    {/if}
    <li>
      <button
        type="button"
        class="hover:bg-base-200 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors {orderBy ===
        'ASC'
          ? 'bg-primary/10'
          : ''}"
        onclick={() => run(() => onorder('ASC'))}
      >
        <span class="text-secondary w-4 shrink-0 text-center font-mono text-base">↑</span>
        <p class="text-secondary text-sm font-semibold">{m.sql_diagram_menu_order_asc()}</p>
      </button>
    </li>
    <li>
      <button
        type="button"
        class="hover:bg-base-200 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors {orderBy ===
        'DESC'
          ? 'bg-primary/10'
          : ''}"
        onclick={() => run(() => onorder('DESC'))}
      >
        <span class="text-secondary w-4 shrink-0 text-center font-mono text-base">↓</span>
        <p class="text-secondary text-sm font-semibold">{m.sql_diagram_menu_order_desc()}</p>
      </button>
    </li>
    {#if orderBy}
      <li>
        <button
          type="button"
          class="hover:bg-base-200 flex w-full items-center gap-3 rounded-lg px-3 py-1.5 text-left transition-colors"
          onclick={() => run(onclearorder)}
        >
          <span class="text-error w-4 shrink-0 text-center font-mono text-sm">×</span>
          <p class="text-error text-xs">{m.sql_diagram_menu_remove_order()}</p>
        </button>
      </li>
    {/if}
  </ul>
</div>
