<script lang="ts">
  import * as m from '$lib/paraglide/messages.js';
  import type { SearchSession } from '$lib/storage/search.svelte.js';
  import IconClose from 'virtual:icons/material-symbols/close';

  interface Props {
    sessions: SearchSession[];
    activeId: string;
    onSelect: (id: string) => void;
    onRemove: (id: string) => void;
  }

  let { sessions, activeId, onSelect, onRemove }: Props = $props();
</script>

{#if sessions.length > 1}
  <nav
    class="border-base-300 flex overflow-x-auto border-b px-5 pt-2"
    aria-label={m.storage_search_sessions_label()}
  >
    {#each sessions as session (session.id)}
      <div class="flex shrink-0 items-center">
        <button
          type="button"
          class={[
            'tab tab-sm gap-1.5 font-mono text-xs',
            { 'tab-active text-primary': activeId === session.id }
          ]}
          aria-current={activeId === session.id ? 'page' : undefined}
          onclick={() => onSelect(session.id)}
        >
          {session.label}
          {#if session.status === 'running'}<span
              class="loading loading-spinner loading-xs"
              aria-label={m.storage_search_status_running()}
            ></span>{/if}
          {#if session.status === 'done'}<span class="badge badge-success badge-xs"
              >{m.storage_search_status_done()}</span
            >{/if}
          {#if session.status === 'error'}<span class="badge badge-error badge-xs"
              >{m.storage_search_status_error()}</span
            >{/if}
        </button>
        <button
          type="button"
          class="btn btn-ghost btn-xs btn-square"
          aria-label={m.storage_search_remove_session({ name: session.label })}
          onclick={() => onRemove(session.id)}
          ><IconClose class="size-3" aria-hidden="true" /></button
        >
      </div>
    {/each}
  </nav>
{/if}
