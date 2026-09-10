<script lang="ts">
  import IconWarning from 'virtual:icons/material-symbols/warning';
  import IconCheckCircle from 'virtual:icons/material-symbols/check-circle';
  import * as m from '$lib/paraglide/messages.js';
  import Modal from '$lib/components/Modal.svelte';
  import ConflictEntry from './ConflictEntry.svelte';
  import type {
    ConflictEntry as ConflictEntryType,
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

  // ── Bulk resolution ────────────────────────────────────────────────────────

  function skipAll() {
    localEntries = localEntries.map((e) =>
      e.conflict
        ? { ...e, resolution: 'skip' as Resolution, renameState: 'idle' as RenameState }
        : e
    );
  }

  function replaceAll() {
    localEntries = localEntries.map((e) =>
      e.conflict
        ? { ...e, resolution: 'replace' as Resolution, renameState: 'idle' as RenameState }
        : e
    );
  }

  // ── Resolution handlers ────────────────────────────────────────────────────

  function setResolution(id: string, res: Resolution) {
    localEntries = localEntries.map((e) =>
      e.id === id
        ? {
            ...e,
            resolution: res,
            renameState: (res === 'rename' ? 'editing' : 'idle') as RenameState
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
    if (newName === '' || newName === entry.originalName) return;

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

    <div class="mb-2 flex justify-end gap-2">
      <button class="btn btn-ghost btn-xs" onclick={skipAll}>
        {m.storage_upload_skip_all()}
      </button>
      <button class="btn btn-ghost btn-xs" onclick={replaceAll}>
        {m.storage_upload_replace_all()}
      </button>
    </div>

    <ul
      class="border-base-300 mb-4 max-h-72 divide-y overflow-y-auto rounded-lg border"
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

    <div class="flex justify-end gap-2">
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
    </div>
  </div>
</Modal>
