<script lang="ts" module>
  export type RunMode = 'cursor' | 'all';
</script>

<script lang="ts">
  import * as m from '$lib/paraglide/messages.js';
  import Dropdown from '$lib/components/ui/Dropdown.svelte';
  import { handleMenuKeydown, menuItems } from '$lib/components/ui/menu-keyboard.js';
  import IconExpandMore from 'virtual:icons/material-symbols/expand-more';
  import IconCheck from 'virtual:icons/material-symbols/check';

  let {
    runMode = $bindable('cursor'),
    hasSelection,
    isActive,
    disabled,
    onRun
  }: {
    runMode?: RunMode;
    /** Text is selected in the editor, so "run all" runs the selection instead. */
    hasSelection: boolean;
    /** A query is running. */
    isActive: boolean;
    /** Running is not possible yet, e.g. while the editor loads. */
    disabled: boolean;
    onRun: () => void;
  } = $props();

  const options = $derived<{ mode: RunMode; label: string; shortcut: string }[]>([
    { mode: 'cursor', label: m.trino_run_at_cursor(), shortcut: 'Ctrl+↵' },
    {
      mode: 'all',
      label: hasSelection ? m.trino_run_selected() : m.trino_run_all(),
      shortcut: 'Ctrl+Shift+↵'
    }
  ]);
  const current = $derived(options.find((o) => o.mode === runMode) ?? options[0]);

  // ── Run mode menu (WAI-ARIA menu button pattern) ──
  let open = $state(false);
  // The menu is at least as wide as the whole button group, so it lines up with "Run". Its
  // min-width subtracts the panel's p-1.5 on both sides (0.75rem).
  let groupWidth = $state(0);
  // The item that gets the focus when the menu opens.
  let focusIndex = 0;

  function checkedIndex(): number {
    return Math.max(
      0,
      options.findIndex((o) => o.mode === runMode)
    );
  }

  function selectMode(mode: RunMode) {
    runMode = mode;
    open = false;
  }

  function handleToggleKeydown(event: KeyboardEvent) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    focusIndex = event.key === 'ArrowDown' ? checkedIndex() : options.length - 1;
    open = true;
  }
</script>

{#snippet runOption(label: string, shortcut: string)}
  <span class="flex flex-col items-start text-xs font-semibold whitespace-nowrap">
    <span>{label}</span>
    <kbd class="kbd kbd-xs text-base-content opacity-80">{shortcut}</kbd>
  </span>
{/snippet}

<div class="join" bind:offsetWidth={groupWidth}>
  <button
    type="button"
    class="btn join-item btn-primary py-1.5"
    disabled={isActive || disabled}
    aria-label={current.label}
    onclick={onRun}
  >
    <span
      class="
          grid
          *:[grid-area:1/1]
        "
    >
      <!-- Invisible sizers: longest option sets width, and the size stays put while running -->
      {#each options as option (option.mode)}
        <span class="invisible" aria-hidden="true">
          {@render runOption(option.label, 'Ctrl+Shift+↵')}
        </span>
      {/each}
      {#if isActive}
        <span class="flex items-center gap-1 self-center text-xs font-semibold">
          <span class="loading loading-xs loading-spinner"></span>
          {m.trino_running()}
        </span>
      {:else}
        {@render runOption(current.label, current.shortcut)}
      {/if}
    </span>
  </button>
  <!-- A wrapper, so that the toggle stays the join's last child next to the popover. -->
  <div class="flex">
    <Dropdown
      bind:open
      align="end"
      bare
      class="rounded-box bg-primary text-primary-content w-max p-1.5 shadow-lg"
      onopen={(panel) => menuItems(panel)[focusIndex]?.focus()}
    >
      {#snippet trigger(dropdown)}
        <button
          {...dropdown}
          type="button"
          class="
            btn join-item border-l-primary-content/20 btn-primary
            tooltip tooltip-left z-150 self-stretch border-l px-2 before:z-200
            {open ? 'before:hidden after:hidden' : ''}"
          data-tip={m.trino_run_mode_select()}
          disabled={isActive}
          aria-label={m.trino_run_mode_select()}
          onclick={() => (focusIndex = checkedIndex())}
          onkeydown={handleToggleKeydown}
        >
          <IconExpandMore class="size-3" aria-hidden="true" />
        </button>
      {/snippet}
      <div
        role="menu"
        tabindex="-1"
        aria-label={m.trino_run_mode_select()}
        class="flex flex-col gap-1"
        style:min-width="calc({groupWidth}px - 0.75rem)"
        onkeydown={(e) => handleMenuKeydown(e, e.currentTarget)}
      >
        {#each options as option (option.mode)}
          {@const checked = option.mode === runMode}
          <button
            type="button"
            role="menuitemradio"
            aria-checked={checked}
            tabindex="-1"
            class="
              rounded-field hover:bg-primary-content/20 focus-visible:outline-primary-content
              flex cursor-pointer items-center justify-between gap-2 px-3 py-1.5 text-left
              {checked ? 'bg-primary-content/15' : ''}"
            onclick={() => selectMode(option.mode)}
          >
            {@render runOption(option.label, option.shortcut)}
            <!-- The check mark shows the selected mode without relying on colour -->
            <IconCheck class="size-4 shrink-0 {checked ? '' : 'invisible'}" aria-hidden="true" />
          </button>
        {/each}
      </div>
    </Dropdown>
  </div>
</div>
