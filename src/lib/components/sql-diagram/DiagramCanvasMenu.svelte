<script lang="ts">
  import * as m from '$lib/paraglide/messages.js';
  import { COMMAND_TYPES, type CommandType } from '$lib/sql-diagram/types.js';

  interface Props {
    x: number;
    y: number;
    onselect: (cmd: CommandType) => void;
    onclose: () => void;
  }

  let { x, y, onselect, onclose }: Props = $props();

  const descriptions: Record<CommandType, () => string> = {
    JOIN: m.sql_diagram_cmd_join_desc,
    WHERE: m.sql_diagram_cmd_where_desc,
    'ORDER BY': m.sql_diagram_cmd_order_desc,
    'GROUP BY': m.sql_diagram_cmd_group_desc,
    LIMIT: m.sql_diagram_cmd_limit_desc
  };

  function clamp(rawX: number, rawY: number) {
    const left = Math.min(rawX, window.innerWidth - 240);
    const top = Math.min(rawY, window.innerHeight - 320);
    return `left:${left}px;top:${top}px`;
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
      {m.sql_diagram_add_command()}
    </p>
  </div>
  <ul class="space-y-0.5 p-1.5">
    {#each COMMAND_TYPES as cmd (cmd)}
      <li>
        <button
          type="button"
          class="hover:bg-base-200 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors"
          onclick={() => {
            onselect(cmd);
            onclose();
          }}
        >
          <div>
            <p class="text-sm font-semibold">{cmd}</p>
            <p class="text-base-content/50 text-[11px]">{descriptions[cmd]()}</p>
          </div>
        </button>
      </li>
    {/each}
  </ul>
</div>
