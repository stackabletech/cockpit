<script lang="ts">
  import * as m from '$lib/paraglide/messages.js';
  import DateTimePicker from '$lib/components/DateTimePicker.svelte';
  import {
    FILTER_OPERATORS,
    parseDateFilterValue,
    parseSizeFilterValue,
    type SearchFilter,
    type SearchFilterField,
    type SearchFilterOperator
  } from '$lib/storage/search-filter.js';
  import IconClose from 'virtual:icons/material-symbols/close';

  interface Props {
    filter: SearchFilter;
    onupdate: (patch: Partial<SearchFilter>) => void;
    onremove: () => void;
  }

  let { filter, onupdate, onremove }: Props = $props();

  const uid = $props.id();

  const hasError = $derived(
    filter.value.trim() !== '' &&
      (filter.field === 'date'
        ? parseDateFilterValue(filter) === null
        : parseSizeFilterValue(filter) === null)
  );

  function setField(field: SearchFilterField): void {
    onupdate({ field });
  }

  function setOperator(operator: SearchFilterOperator): void {
    onupdate({ operator });
  }
</script>

<div class="flex items-center gap-2">
  <div class="shrink-0">
    <label class="sr-only" for="{uid}-field">{m.storage_search_filter_field_label()}</label>
    <select
      id="{uid}-field"
      class="select select-sm border-base-300 w-28 font-medium"
      value={filter.field}
      onchange={(event) => setField(event.currentTarget.value as SearchFilterField)}
    >
      <option value="date">{m.storage_search_filter_date()}</option>
      <option value="size">{m.storage_search_filter_size()}</option>
    </select>
  </div>

  <div
    class="border-base-300 bg-base-100/50 focus-within:border-primary flex min-w-0 flex-1 items-center gap-1.5 rounded-lg border px-1.5 {hasError
      ? 'border-error bg-error/5'
      : ''}"
    title={hasError ? m.storage_search_filter_invalid() : undefined}
  >
    <label class="sr-only" for="{uid}-operator">{m.storage_search_filter_operator()}</label>
    <select
      id="{uid}-operator"
      class="select select-sm border-base-300/0 h-auto min-h-0 w-14 flex-shrink-0 border-0 ps-2 pe-7 text-center font-mono text-sm"
      value={filter.operator}
      onchange={(event) => setOperator(event.currentTarget.value as SearchFilterOperator)}
    >
      {#each FILTER_OPERATORS as op (op)}
        <option value={op}>{op}</option>
      {/each}
    </select>
    <span class="border-base-300 h-5 w-px border-l" aria-hidden="true"></span>

    {#if filter.field === 'size'}
      <label class="sr-only" for="{uid}-value">{m.storage_search_filter_value_size()}</label>
      <input
        id="{uid}-value"
        class="min-w-0 grow bg-transparent px-1 py-1 text-sm focus:outline-none"
        type="text"
        inputmode="decimal"
        autocomplete="off"
        spellcheck="false"
        value={filter.value}
        oninput={(event) => onupdate({ value: event.currentTarget.value })}
        placeholder={m.storage_search_filter_size_placeholder()}
        aria-invalid={hasError || undefined}
      />
    {:else}
      <label class="sr-only" for="{uid}-value">{m.storage_search_filter_value_date()}</label>
      <DateTimePicker
        id="{uid}-value"
        class="grow"
        placeholder={m.storage_search_filter_date_placeholder()}
        invalid={hasError}
        bind:value={filter.value}
      />
    {/if}
  </div>

  <button
    type="button"
    class="btn btn-ghost btn-square btn-xs shrink-0"
    aria-label={m.storage_search_filter_remove()}
    title={m.storage_search_filter_remove()}
    onclick={onremove}><IconClose class="size-3.5" aria-hidden="true" /></button
  >
</div>
