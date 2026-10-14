<script lang="ts">
  import IconWarning from 'virtual:icons/material-symbols/warning';
  import IconCheckCircle from 'virtual:icons/material-symbols/check-circle';
  import * as m from '$lib/paraglide/messages.js';
  import Modal from '$lib/components/Modal.svelte';
  import ConflictEntry from './ConflictEntry.svelte';
  import { ConflictRenameNameSchema } from '$lib/storage/schemas.js';
  import { objectNameError } from '$lib/storage/name-validation.js';
  import type {
    ConflictEntry as ConflictEntryType,
    RefusedEntry,
    Resolution,
    RenameState
  } from './conflict-types.js';

  interface Props {
    open?: boolean;
    /** Only the conflicting entries (each must have conflict=true). */
    entries: ConflictEntryType[];
    /** Optional: custom title shown at the top. Defaults to "Files already exist". */
    title?: string;
    /** Optional: description text. Defaults to "Choose what to do for each conflicting file." */
    description?: string;
    /** Optional: label for the confirm button. Defaults to "Confirm". */
    confirmLabel?: string;
    /**
     * Optional: custom rename-conflict checker.
     * Called with the entry's local state (including current customName).
     * Return true if the new name is available, false if it conflicts.
     * When not provided, rename is always accepted as available.
     */
    onCheckRename?: (entry: ConflictEntryType) => Promise<boolean>;
    /** Optional: items that cannot be transferred, shown with their reason. */
    refused?: RefusedEntry[];
    /** Nothing would be sent whatever is chosen: offer only Close. */
    closeOnly?: boolean;
    onConfirm: (entries: ConflictEntryType[]) => void;
    onCancel: () => void;
  }

  let {
    open = $bindable(false),
    entries: initialEntries,
    title,
    description,
    confirmLabel,
    onCheckRename,
    refused = [],
    closeOnly = false,
    onConfirm,
    onCancel
  }: Props = $props();

  // Local copy of entries for reactive state management
  let localEntries = $state<ConflictEntryType[]>([]);

  // Sync from initialEntries when the dialog opens
  $effect(() => {
    if (open) {
      localEntries = initialEntries.map((e) => ({ ...e }));
    }
  });

  const conflictEntries = $derived(localEntries.filter((e) => e.conflict));
  const hasUnresolved = $derived(conflictEntries.some((e) => e.resolution === null));
  const hasUnconfirmedRename = $derived(
    localEntries.some((e) => e.resolution === 'rename' && e.renameState !== 'ok')
  );
  const canProceed = $derived(!hasUnresolved && !hasUnconfirmedRename);
  const hasFileConflicts = $derived(conflictEntries.some((e) => e.kind !== 'folder'));
  const hasFolderConflicts = $derived(conflictEntries.some((e) => e.kind === 'folder'));

  // ── Bulk resolution ────────────────────────────────────────────────────────

  function skipAll() {
    localEntries = localEntries.map((e) =>
      e.conflict ? { ...e, resolution: 'skip', renameState: 'idle' } : e
    );
  }

  function replaceAll() {
    localEntries = localEntries.map((e) =>
      e.conflict && e.kind !== 'folder' ? { ...e, resolution: 'replace', renameState: 'idle' } : e
    );
  }

  function mergeAll() {
    localEntries = localEntries.map((e) =>
      e.conflict && e.kind === 'folder' ? { ...e, resolution: 'merge', renameState: 'idle' } : e
    );
  }

  function renameError(entry: ConflictEntryType, newName: string): boolean {
    if (entry.destPrefix === undefined) return !ConflictRenameNameSchema.safeParse(newName).success;
    return (
      objectNameError(newName, {
        prefix: entry.destPrefix,
        folder: entry.kind === 'folder',
        singleSegment: true
      }) !== null
    );
  }

  // ── Resolution handlers ────────────────────────────────────────────────────

  function setResolution(id: string, res: Resolution) {
    localEntries = localEntries.map((e) =>
      e.id === id
        ? {
            ...e,
            resolution: res,
            renameState: res === 'rename' ? 'editing' : 'idle'
          }
        : e
    );
  }

  function setCustomName(id: string, name: string) {
    localEntries = localEntries.map((e) =>
      e.id === id ? { ...e, customName: name, renameState: 'editing' as const } : e
    );
  }

  async function handleRenameButtonClick(id: string) {
    const entry = localEntries.find((e) => e.id === id);
    if (!entry) return;
    if (entry.resolution !== 'rename') {
      setResolution(id, 'rename');
    } else if (entry.renameState === 'ok') {
      localEntries = localEntries.map((e) =>
        e.id === id ? { ...e, renameState: 'editing' as const } : e
      );
    } else if (entry.renameState === 'editing' || entry.renameState === 'conflict') {
      await doCheckRename(id);
    }
  }

  async function doCheckRename(id: string) {
    const entry = localEntries.find((e) => e.id === id);
    if (!entry || entry.resolution !== 'rename') return;
    const newName = entry.customName.trim();
    if (newName === entry.originalName || renameError(entry, newName)) return;

    localEntries = localEntries.map((e) =>
      e.id === id ? { ...e, renameState: 'checking' as const } : e
    );

    try {
      const available = onCheckRename ? await onCheckRename(entry) : true;
      const nextState: RenameState = available ? 'ok' : 'conflict';
      localEntries = localEntries.map((e) => (e.id === id ? { ...e, renameState: nextState } : e));
    } catch {
      localEntries = localEntries.map((e) =>
        e.id === id ? { ...e, renameState: 'editing' as const } : e
      );
    }
  }

  function handleConfirm() {
    if (!canProceed) return;
    onConfirm(localEntries);
  }
</script>

<Modal bind:open class="modal">
  <div class="modal-box w-full max-w-lg">
    <div class="mb-3 flex items-start gap-2">
      <IconWarning class="text-warning mt-0.5 size-5 shrink-0" aria-hidden="true" />
      <div>
        <p class="text-base-content font-semibold">
          {title ?? m.storage_upload_conflicts_title()}
        </p>
        <p class="text-base-content/60 mt-0.5 text-sm">
          {description ?? m.storage_upload_conflicts_desc()}
        </p>
      </div>
    </div>

    {#if conflictEntries.length > 0}
      <div class="mb-2 flex flex-wrap justify-end gap-2">
        <button class="btn btn-ghost btn-xs" onclick={skipAll}>
          {m.storage_upload_skip_all()}
        </button>
        {#if hasFileConflicts}
          <button class="btn btn-ghost btn-xs" onclick={replaceAll}>
            {m.storage_upload_replace_all()}
          </button>
        {/if}
        {#if hasFolderConflicts}
          <button class="btn btn-ghost btn-xs" onclick={mergeAll}>
            {m.storage_transfer_merge_all()}
          </button>
        {/if}
      </div>
      {#if hasFolderConflicts}
        <p class="text-base-content/60 mb-2 text-xs">{m.storage_transfer_merge_note()}</p>
      {/if}
    {/if}

    <ul
      class="border-base-300 mb-4 max-h-72 divide-y overflow-y-auto rounded-lg border"
      class:hidden={conflictEntries.length === 0}
      aria-label={title ?? m.storage_upload_conflicts_title()}
    >
      {#each conflictEntries as entry (entry.id)}
        <ConflictEntry
          {entry}
          onSetResolution={(res) => setResolution(entry.id, res)}
          onSetCustomName={(name) => setCustomName(entry.id, name)}
          onRenameButtonClick={() => handleRenameButtonClick(entry.id)}
          onCheckRename={() => doCheckRename(entry.id)}
        />
      {/each}
    </ul>

    {#if refused.length > 0}
      {#if conflictEntries.length > 0}
        <p class="text-base-content mb-1 text-sm font-semibold">
          {m.storage_transfer_refused_title()}
        </p>
      {/if}
      <ul
        class="border-base-300 mb-4 max-h-40 divide-y overflow-y-auto rounded-lg border"
        aria-label={m.storage_transfer_refused_title()}
      >
        {#each refused as item, index (index)}
          <li class="px-4 py-2 text-sm">
            <span class="text-base-content font-medium">&ldquo;{item.name}&rdquo;</span>
            <span class="text-base-content/70 block">{item.reason}</span>
          </li>
        {/each}
      </ul>
    {/if}

    <div class="flex justify-end gap-2">
      {#if closeOnly}
        <button class="btn btn-primary btn-sm" onclick={onCancel}>
          {m.storage_transfer_close()}
        </button>
      {:else}
        <button class="btn btn-ghost btn-sm" onclick={onCancel}>
          {m.storage_upload_overwrite_cancel()}
        </button>
        <button
          class="btn btn-primary btn-sm gap-1"
          onclick={handleConfirm}
          disabled={!canProceed}
          aria-disabled={!canProceed}
        >
          <IconCheckCircle class="size-4" aria-hidden="true" />
          {confirmLabel ?? m.storage_upload_start()}
        </button>
      {/if}
    </div>
  </div>
</Modal>
