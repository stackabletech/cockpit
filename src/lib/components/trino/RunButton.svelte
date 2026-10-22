<script lang="ts" module>
  export type RunMode = 'cursor' | 'all';
</script>

<script lang="ts">
  import { tick } from 'svelte';
  import * as m from '$lib/paraglide/messages.js';
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

  const uid = $props.id();

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
  let container = $state<HTMLElement | null>(null);
  let toggle = $state<HTMLButtonElement | null>(null);
  let items = $state<HTMLButtonElement[]>([]);

  async function openMenu(focusIndex: number) {
    open = true;
    await tick();
    items[focusIndex]?.focus();
  }

  function closeMenu(returnFocus: boolean) {
    open = false;
    if (returnFocus) toggle?.focus();
  }

  function selectMode(mode: RunMode) {
    runMode = mode;
    closeMenu(true);
  }

  function checkedIndex(): number {
    return Math.max(
      0,
      options.findIndex((o) => o.mode === runMode)
    );
  }

  function handleToggleKeydown(event: KeyboardEvent) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      void openMenu(checkedIndex());
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      void openMenu(options.length - 1);
    }
  }

  function handleToggleClick() {
    if (open) closeMenu(false);
    else void openMenu(checkedIndex());
  }

  function handleMenuKeydown(event: KeyboardEvent) {
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const last = options.length - 1;
    let next: number | null = null;
    if (event.key === 'ArrowDown') next = index >= last ? 0 : index + 1;
    else if (event.key === 'ArrowUp') next = index <= 0 ? last : index - 1;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = last;
    else if (event.key === 'Escape') {
      event.preventDefault();
      closeMenu(true);
      return;
    } else if (event.key === 'Tab') {
      closeMenu(false);
      return;
    }
    if (next !== null) {
      event.preventDefault();
      items[next]?.focus();
    }
  }

  function handleFocusOut(event: FocusEvent) {
    // Close when focus moves to another element outside the button group and its menu. Without
    // a relatedTarget focus went nowhere: Firefox and Safari don't focus buttons on click, so a
    // click on the toggle lands here; outside clicks are handled by handleWindowPointerDown.
    const next = event.relatedTarget as Node | null;
    if (open && next && !container?.contains(next)) closeMenu(false);
  }

  function handleWindowPointerDown(event: PointerEvent) {
    if (open && !container?.contains(event.target as Node)) closeMenu(false);
  }
</script>

<svelte:window onpointerdown={handleWindowPointerDown} />

{#snippet runOption(label: string, shortcut: string)}
  <span class="flex flex-col items-start text-xs font-semibold whitespace-nowrap">
    <span>{label}</span>
    <kbd class="kbd kbd-xs text-base-content opacity-80">{shortcut}</kbd>
  </span>
{/snippet}

<div bind:this={container} class="relative" onfocusout={handleFocusOut}>
  <div class="join">
    <button
      type="button"
      class="btn join-item btn-primary py-1.5"
      disabled={isActive || disabled}
      aria-label={current.label}
      onclick={onRun}
    >
      {#if isActive}
        <span class="loading loading-xs loading-spinner"></span>
        {m.trino_running()}
      {:else}
        <span
          class="
            grid
            *:[grid-area:1/1]
          "
        >
          <!-- Invisible sizers: longest option sets width -->
          {#each options as option (option.mode)}
            <span class="invisible" aria-hidden="true">
              {@render runOption(option.label, 'Ctrl+Shift+↵')}
            </span>
          {/each}
          {@render runOption(current.label, current.shortcut)}
        </span>
      {/if}
    </button>
    <button
      bind:this={toggle}
      type="button"
      class="
        btn join-item border-l-primary-content/20 btn-primary
        tooltip-bottom z-150 self-stretch border-l px-2 before:z-200
      "
      class:tooltip={!open}
      data-tip={m.trino_run_mode_select()}
      disabled={isActive}
      aria-haspopup="menu"
      aria-expanded={open}
      aria-controls="{uid}-menu"
      aria-label={m.trino_run_mode_select()}
      onclick={handleToggleClick}
      onkeydown={handleToggleKeydown}
    >
      <IconExpandMore class="size-3" aria-hidden="true" />
    </button>
  </div>
  {#if open}
    <div
      id="{uid}-menu"
      role="menu"
      tabindex="-1"
      aria-label={m.trino_run_mode_select()}
      class="
        rounded-box bg-primary text-primary-content absolute top-full right-0 z-10 mt-1 flex
        w-max min-w-full flex-col gap-1 p-1.5 shadow-lg
      "
      onkeydown={handleMenuKeydown}
    >
      {#each options as option, index (option.mode)}
        {@const checked = option.mode === runMode}
        <button
          bind:this={items[index]}
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
  {/if}
</div>
