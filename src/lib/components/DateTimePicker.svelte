<script lang="ts">
  import { DateFormatter } from '@internationalized/date';
  import { getLocale } from '$lib/paraglide/runtime.js';
  import * as m from '$lib/paraglide/messages.js';
  import { formatDateValue, parseDateInput } from '$lib/storage/search-filter.js';
  import {
    positionPopoverRelativeToTrigger,
    supportsAnchorPositioning
  } from '$lib/components/popover-position.js';
  import IconCalendar from 'virtual:icons/material-symbols/calendar-today';
  import IconChevronLeft from 'virtual:icons/material-symbols/chevron-left';
  import IconChevronRight from 'virtual:icons/material-symbols/chevron-right';

  interface Props {
    /** Raw, user-editable date text. Writes back ISO (YYYY-MM-DD) on pick. */
    value?: string;
    /** The id of the text input, for label association. */
    id?: string;
    placeholder?: string;
    /** Marks the control as invalid so it can be styled by the parent. */
    invalid?: boolean;
    class?: string;
  }

  let {
    value = $bindable(''),
    id,
    placeholder,
    invalid = false,
    class: className = ''
  }: Props = $props();

  const uid = $props.id();
  const popoverId = `${uid}-calendar`;
  const anchorName = `--datepicker-${uid}`;

  const locale = $derived(getLocale());
  const startDay = $derived(locale === 'de' ? 1 : 0);

  const monthYearFormatter = $derived(
    new DateFormatter(locale, { month: 'long', year: 'numeric' })
  );
  const weekdayFormatter = $derived(new DateFormatter(locale, { weekday: 'short' }));
  const dayFormatter = $derived(
    new DateFormatter(locale, { day: 'numeric', month: 'long', year: 'numeric' })
  );

  // Weekday names indexed by Date#getDay() (0 = Sunday), then rotated so the
  // grid starts on the locale-appropriate day.
  const weekdayNames = $derived.by(() => {
    const byDay = Array.from({ length: 7 }, (_, index) =>
      weekdayFormatter.format(new Date(2024, 8, 1 + index))
    );
    return Array.from({ length: 7 }, (_, index) => byDay[(startDay + index) % 7]);
  });

  const parsedDate = $derived(parseDateInput(value));
  const selectedIso = $derived(parsedDate ? formatDateValue(parsedDate) : '');

  let popoverEl = $state<HTMLDivElement>();
  let triggerEl = $state<HTMLButtonElement>();
  let open = $state(false);
  let viewYear = $state(0);
  let viewMonth = $state(0);

  const monthLabel = $derived(monthYearFormatter.format(new Date(viewYear, viewMonth, 1)));

  const weeks = $derived.by(() => {
    if (viewYear === 0) return [];
    const firstOfMonth = new Date(viewYear, viewMonth, 1);
    const offset = (firstOfMonth.getDay() - startDay + 7) % 7;
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const cells: Array<{ key: string; date: Date | null }> = [];
    for (let index = 0; index < offset; index += 1)
      cells.push({ key: `blank-${index}`, date: null });
    for (let day = 1; day <= daysInMonth; day += 1) {
      const date = new Date(viewYear, viewMonth, day);
      cells.push({ key: String(date.getTime()), date });
    }
    for (let trailing = cells.length; trailing % 7 !== 0; trailing += 1) {
      cells.push({ key: `trailing-${trailing}`, date: null });
    }
    return cells;
  });

  const todayIso = $derived(formatDateValue(new Date()));

  function handleToggle(event: Event): void {
    const newState = (event as Event & { newState: 'open' | 'closed' }).newState;
    open = newState === 'open';
    if (open) {
      const base = parsedDate ?? new Date();
      viewYear = base.getFullYear();
      viewMonth = base.getMonth();
      if (!supportsAnchorPositioning() && triggerEl && popoverEl) {
        positionPopoverRelativeToTrigger(triggerEl, popoverEl, { align: 'end' });
      }
    }
  }

  function shiftMonth(delta: number): void {
    viewMonth += delta;
    if (viewMonth < 0) {
      viewMonth = 11;
      viewYear -= 1;
    } else if (viewMonth > 11) {
      viewMonth = 0;
      viewYear += 1;
    }
  }

  function selectDate(date: Date): void {
    value = formatDateValue(date);
    popoverEl?.hidePopover();
  }
</script>

<div class={`flex min-w-0 items-center ${className}`}>
  <input
    {id}
    class="h-8 min-w-0 grow bg-transparent px-1 text-sm focus:outline-none"
    type="text"
    inputmode="text"
    autocomplete="off"
    spellcheck="false"
    {value}
    oninput={(event) => (value = event.currentTarget.value)}
    aria-invalid={invalid || undefined}
    {placeholder}
  />
  <button
    type="button"
    class="btn btn-ghost btn-xs btn-square shrink-0"
    bind:this={triggerEl}
    style={`anchor-name:${anchorName}`}
    popovertarget={popoverId}
    aria-haspopup="dialog"
    aria-expanded={open}
    aria-label={m.datepicker_open()}
    title={m.datepicker_open()}><IconCalendar class="size-4" aria-hidden="true" /></button
  >
</div>

<div
  id={popoverId}
  popover
  bind:this={popoverEl}
  role="dialog"
  aria-label={m.datepicker_label()}
  class="dropdown dropdown-end border-base-300 bg-base-100 w-72 rounded-lg border p-3 shadow-lg"
  style={`position-anchor:${anchorName}`}
  ontoggle={handleToggle}
>
  <div class="mb-2 flex items-center justify-between">
    <button
      type="button"
      class="btn btn-ghost btn-xs btn-square"
      aria-label={m.datepicker_previous_month()}
      title={m.datepicker_previous_month()}
      onclick={() => shiftMonth(-1)}><IconChevronLeft class="size-4" aria-hidden="true" /></button
    >
    <span class="text-sm font-medium">{monthLabel}</span>
    <button
      type="button"
      class="btn btn-ghost btn-xs btn-square"
      aria-label={m.datepicker_next_month()}
      title={m.datepicker_next_month()}
      onclick={() => shiftMonth(1)}><IconChevronRight class="size-4" aria-hidden="true" /></button
    >
  </div>
  <div class="grid grid-cols-7 gap-1">
    {#each weekdayNames as weekday (weekday)}
      <span
        class="text-base-content/50 px-0.5 py-1 text-center text-xs font-medium"
        aria-hidden="true">{weekday}</span
      >
    {/each}
    {#each weeks as cell (cell.key)}
      {#if cell.date}
        {@const iso = formatDateValue(cell.date)}
        {@const selected = iso === selectedIso}
        <button
          type="button"
          class="btn btn-ghost btn-sm h-8 min-h-0 w-8 rounded p-0 text-xs {selected
            ? 'btn-primary'
            : ''} {iso === todayIso ? 'bg-primary/10' : ''}"
          aria-pressed={selected}
          aria-current={iso === todayIso ? 'date' : undefined}
          aria-label={m.datepicker_day_select({ date: dayFormatter.format(cell.date) })}
          onclick={() => selectDate(cell.date!)}>{cell.date.getDate()}</button
        >{:else}<span class="h-8" aria-hidden="true"></span>{/if}
    {/each}
  </div>
</div>
