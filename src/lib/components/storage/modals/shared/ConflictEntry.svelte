<script lang="ts">
  import IconCheck from 'virtual:icons/material-symbols/check';
  import IconCheckCircle from 'virtual:icons/material-symbols/check-circle';
  import * as m from '$lib/paraglide/messages.js';
  import { ConflictRenameNameSchema } from '$lib/storage/schemas.js';
  import { objectNameError } from '$lib/storage/name-validation.js';
  import type { ConflictEntry, Resolution } from './conflict-types.js';

  interface Props {
    entry: ConflictEntry;
    onSetResolution: (resolution: Resolution) => void;
    onSetCustomName: (name: string) => void;
    onRenameButtonClick: () => void;
    onCheckRename: () => void;
  }

  let { entry, onSetResolution, onSetCustomName, onRenameButtonClick, onCheckRename }: Props =
    $props();

  const uid = $props.id();

  let sameName = $derived(
    entry.resolution === 'rename' &&
      (entry.customName.trim() === '' || entry.customName.trim() === entry.originalName)
  );
  // A transfer knows its destination folder, so the full key length is checked too.
  let nameError = $derived.by(() => {
    if (entry.resolution !== 'rename' || sameName) return null;
    const name = entry.customName.trim();
    if (entry.destPrefix !== undefined) {
      return objectNameError(name, {
        prefix: entry.destPrefix,
        folder: entry.kind === 'folder',
        singleSegment: true
      });
    }
    return ConflictRenameNameSchema.safeParse(name).success
      ? null
      : m.storage_name_invalid_single();
  });
  let badRename = $derived(sameName || nameError !== null);
  const folder = $derived(entry.kind === 'folder');
</script>

<li class="px-4 py-3">
  <p class="text-base-content mb-2 truncate text-sm font-medium">
    &ldquo;{entry.originalName}&rdquo;
  </p>
  <!-- Resolution toggle buttons -->
  <div
    class="flex flex-wrap gap-1.5"
    role="group"
    aria-label="{m.storage_upload_conflicts_title()} — {entry.originalName}"
  >
    {#if folder}
      <button
        type="button"
        class="btn btn-xs {entry.resolution === 'merge' ? 'btn-warning' : 'btn-ghost'}"
        onclick={() => onSetResolution('merge')}
        aria-pressed={entry.resolution === 'merge'}
      >
        {m.storage_transfer_resolution_merge()}
      </button>
    {:else}
      <button
        type="button"
        class="btn btn-xs {entry.resolution === 'replace' ? 'btn-warning' : 'btn-ghost'}"
        onclick={() => onSetResolution('replace')}
        aria-pressed={entry.resolution === 'replace'}
      >
        {m.storage_upload_resolution_replace()}
      </button>
    {/if}
    {#if entry.allowKeepBoth}
      <button
        type="button"
        class="btn btn-xs {entry.resolution === 'keepBoth' ? 'btn-info' : 'btn-ghost'}"
        onclick={() => onSetResolution('keepBoth')}
        aria-pressed={entry.resolution === 'keepBoth'}
      >
        {m.storage_transfer_resolution_keep_both()}
      </button>
    {/if}
    <button
      type="button"
      class="btn btn-xs {entry.resolution === 'skip' ? 'btn-neutral' : 'btn-ghost'}"
      onclick={() => onSetResolution('skip')}
      aria-pressed={entry.resolution === 'skip'}
    >
      {m.storage_upload_resolution_skip()}
    </button>
    <button
      type="button"
      class="btn btn-xs gap-1 {entry.resolution !== 'rename'
        ? 'btn-ghost'
        : entry.renameState === 'ok'
          ? 'btn-success'
          : entry.renameState === 'conflict'
            ? 'btn-error'
            : 'btn-primary'}"
      onclick={onRenameButtonClick}
      aria-pressed={entry.resolution === 'rename'}
      disabled={entry.renameState === 'checking'}
    >
      {#if entry.resolution === 'rename' && entry.renameState === 'checking'}
        <span class="loading loading-spinner loading-xs" aria-hidden="true"></span>
      {:else if entry.resolution === 'rename' && entry.renameState === 'ok'}
        <IconCheck class="size-3" aria-hidden="true" />
      {/if}
      {#if entry.resolution === 'rename' && (entry.renameState === 'editing' || entry.renameState === 'conflict')}
        {m.storage_upload_rename_confirm_action()}
      {:else}
        {m.storage_upload_resolution_rename()}
      {/if}
    </button>
  </div>

  <!-- Name field: real <input> only while editing; static display otherwise -->
  <div class="mt-2">
    {#if entry.resolution === 'rename' && (entry.renameState === 'editing' || entry.renameState === 'conflict')}
      <label for="{uid}-rename-{entry.id}" class="label sr-only">
        {m.storage_upload_rename_label()}
      </label>
      <input
        id="{uid}-rename-{entry.id}"
        type="text"
        class="input input-sm w-full {badRename || entry.renameState === 'conflict'
          ? 'input-error'
          : ''}"
        value={entry.customName}
        oninput={(e) => onSetCustomName((e.target as HTMLInputElement).value)}
        onkeydown={(e) => e.key === 'Enter' && void onCheckRename()}
        placeholder={m.storage_upload_rename_label()}
        aria-invalid={badRename || entry.renameState === 'conflict'}
        aria-describedby={badRename || entry.renameState === 'conflict'
          ? `${uid}-rename-err-${entry.id}`
          : undefined}
      />
      {#if sameName}
        <p id="{uid}-rename-err-{entry.id}" class="text-error mt-1 text-xs" role="alert">
          {m.storage_upload_rename_same_name_error()}
        </p>
      {:else if nameError}
        <p id="{uid}-rename-err-{entry.id}" class="text-error mt-1 text-xs" role="alert">
          {nameError}
        </p>
      {:else if entry.renameState === 'conflict'}
        <p id="{uid}-rename-err-{entry.id}" class="text-error mt-1 text-xs" role="alert">
          {m.storage_upload_rename_taken()}
        </p>
      {/if}
    {:else}
      <!-- Static display: not in rename mode, or confirmed/checking -->
      <div class="text-base-content/50 mt-1 flex items-center gap-1 px-1 text-sm">
        <span class="min-w-0 flex-1 truncate">{entry.customName}</span>
        {#if entry.resolution === 'rename' && entry.renameState === 'ok'}
          <IconCheckCircle class="text-success size-3.5 shrink-0" aria-hidden="true" />
        {/if}
      </div>
    {/if}
  </div>
</li>
