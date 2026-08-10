<script lang="ts">
  import Modal from '$lib/components/Modal.svelte';
  import { PRODUCTS, type Product } from '$lib/dashboard/products';
  import { addBookmark, removeBookmark, updateBookmark } from '$lib/dashboard/bookmarks.svelte.js';
  import type { Bookmark } from '$lib/dashboard/types';
  import * as m from '$lib/paraglide/messages.js';

  let {
    open = $bindable(false),
    bookmark = null,
    isAdmin = false
  }: {
    open: boolean;
    bookmark?: Bookmark | null;
    isAdmin?: boolean;
  } = $props();

  let selectedProduct = $state<Product>(PRODUCTS[0]);
  let openIn = $state<'cockpit' | 'new-tab'>('cockpit');
  let name = $state('');
  let userEditedName = $state(false);
  let environment = $state('');
  let url = $state('');
  let pinned = $state(false);
  let pinnedForEveryone = $state(false);
  let confirmDeleteOpen = $state(false);
  let wasOpen = $state(false);
  let skipInitOnOpen = $state(false);

  let uid = $props.id();

  let isEditing = $derived(bookmark !== null);
  let pinEveryoneDisabled = $derived(!isAdmin);

  let pinSectionEl = $state<HTMLDivElement>();
  let parentPinCheckbox = $state<HTMLInputElement>();
  let childPinCheckbox = $state<HTMLInputElement>();
  let connectorPath = $state('');

  $effect(() => {
    if (pinEveryoneDisabled) {
      pinnedForEveryone = false;
    }
  });

  $effect(() => {
    if (!open) {
      connectorPath = '';
      return;
    }
    const section = pinSectionEl;
    const parent = parentPinCheckbox;
    const child = childPinCheckbox;
    if (!section || !parent || !child) return;

    const compute = () => {
      const sectionRect = section.getBoundingClientRect();
      const parentRect = parent.getBoundingClientRect();
      const childRect = child.getBoundingClientRect();
      if (sectionRect.width === 0 || sectionRect.height === 0) return;
      const gap = 8;
      const x1 = parentRect.left + parentRect.width / 2 - sectionRect.left;
      const yStart = parentRect.bottom - sectionRect.top + gap;
      const x2 = childRect.left - sectionRect.left - gap;
      const y2 = childRect.top + childRect.height / 2 - sectionRect.top;
      connectorPath = `M ${x1} ${yStart} V ${y2} H ${x2}`;
    };

    const frame = requestAnimationFrame(compute);
    return () => cancelAnimationFrame(frame);
  });

  function resetForm() {
    selectedProduct = PRODUCTS[0];
    openIn = 'cockpit';
    name = '';
    userEditedName = false;
    environment = '';
    url = '';
    pinned = false;
    pinnedForEveryone = false;
  }

  function initForm(target: Bookmark | null) {
    if (target) {
      selectedProduct = PRODUCTS.find((p) => p.id === target.productId) ?? PRODUCTS[0];
      openIn = target.openIn;
      name = target.name;
      userEditedName = true;
      environment = target.environment;
      url = target.url;
      pinned = target.pinned;
      pinnedForEveryone = target.pinnedForEveryone ?? false;
    } else {
      resetForm();
    }
  }

  $effect(() => {
    const opening = open && !wasOpen;
    wasOpen = open;
    if (!opening) return;
    if (skipInitOnOpen) {
      skipInitOnOpen = false;
      return;
    }
    initForm(bookmark);
  });

  function handleProductSelect(product: Product) {
    selectedProduct = product;
    if (!userEditedName) {
      name = product.defaultName;
    }
  }

  function handleNameInput() {
    userEditedName = true;
  }

  function getDefaultName(): string {
    return selectedProduct.defaultName;
  }

  function getHostname(urlStr: string): string {
    try {
      return new URL(urlStr).hostname;
    } catch {
      return urlStr;
    }
  }

  function handleLogoError(e: Event) {
    const el = e.currentTarget as HTMLImageElement;
    el.style.display = 'none';
    const next = el.nextElementSibling;
    if (next) next.classList.remove('hidden');
  }

  function handleSubmit() {
    if (!name.trim() || !url.trim()) return;

    const values = {
      productId: selectedProduct.id,
      name: name.trim(),
      environment: environment.trim(),
      url: url.trim(),
      openIn,
      pinned,
      // Only admins can set the "pin for everyone" flag; non-admins keep the
      // existing value (e.g. when editing a bookmark pinned by an admin).
      pinnedForEveryone: isAdmin ? pinnedForEveryone : (bookmark?.pinnedForEveryone ?? false)
    };

    if (bookmark) {
      updateBookmark({ ...bookmark, ...values });
    } else {
      addBookmark({ id: crypto.randomUUID(), createdAt: new Date().toISOString(), ...values });
    }
    resetForm();
    open = false;
  }

  function handleDeleteClick() {
    skipInitOnOpen = true;
    open = false;
    confirmDeleteOpen = true;
  }

  function handleDeleteCancel() {
    confirmDeleteOpen = false;
    open = true;
  }

  function handleDeleteConfirm() {
    if (!bookmark) return;
    removeBookmark(bookmark.id);
    confirmDeleteOpen = false;
    resetForm();
  }
</script>

<Modal bind:open class="modal">
  <div class="modal-box max-w-2xl">
    <form method="dialog">
      <button
        class="btn btn-sm btn-circle btn-ghost absolute top-2 right-2"
        aria-label={m.button_close()}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="size-5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"><path d="M18 6L6 18M6 6l12 12" /></svg
        >
      </button>
    </form>

    <h3 class="text-base-content text-lg font-bold">
      {isEditing ? m.bookmark_edit_title() : m.bookmark_add_title()}
    </h3>

    <div class="mt-6 space-y-6">
      <!-- Section 1: Product selection -->
      <fieldset>
        <legend class="text-base-content/80 mb-3 text-sm font-medium"
          >{m.bookmark_product_label()}</legend
        >
        <div class="flex flex-wrap gap-2">
          {#each PRODUCTS as product (product.id)}
            <button
              type="button"
              onclick={() => handleProductSelect(product)}
              class="
                flex cursor-pointer items-center gap-2 rounded-full px-3 py-1.5 text-sm transition-colors
                {selectedProduct.id === product.id
                ? 'ring-primary bg-primary/10 ring-2 ring-offset-1'
                : 'bg-base-200 text-base-content/70 hover:bg-base-300'}
              "
              aria-pressed={selectedProduct.id === product.id}
            >
              {#if product.logo}
                <enhanced:img
                  src={product.logo}
                  alt={product.name}
                  class="size-5 rounded-full bg-white object-contain p-0.5"
                  onerror={handleLogoError}
                />
                <span
                  class="flex hidden size-5 items-center justify-center rounded-full text-[10px] font-bold text-white"
                  style="background-color: {product.color}"
                >
                  {product.initials}
                </span>
              {:else}
                <span
                  class="flex size-5 items-center justify-center rounded-full text-[10px] font-bold text-white"
                  style="background-color: {product.color}"
                >
                  {product.initials}
                </span>
              {/if}
              {product.name}
            </button>
          {/each}
        </div>
      </fieldset>

      <!-- Section 2: Open in -->
      <fieldset>
        <legend class="text-base-content/80 mb-2 text-sm font-medium"
          >{m.bookmark_open_in_label()}</legend
        >
        <div class="grid grid-cols-2 gap-3">
          <button
            type="button"
            onclick={() => (openIn = 'cockpit')}
            class="
              flex cursor-pointer flex-col items-start gap-1 rounded-xl border p-4 text-left transition-colors
              {openIn === 'cockpit'
              ? 'border-primary bg-primary/5 ring-primary ring-1'
              : 'border-base-300 bg-base-200 hover:border-base-content/30'}
            "
            aria-pressed={openIn === 'cockpit'}
          >
            <span class="text-base-content text-sm font-semibold"
              >{m.bookmark_open_in_cockpit()}</span
            >
            <span class="text-base-content/50 text-xs leading-tight"
              >{m.bookmark_open_in_cockpit_desc()}</span
            >
          </button>
          <button
            type="button"
            onclick={() => (openIn = 'new-tab')}
            class="
              flex cursor-pointer flex-col items-start gap-1 rounded-xl border p-4 text-left transition-colors
              {openIn === 'new-tab'
              ? 'border-primary bg-primary/5 ring-primary ring-1'
              : 'border-base-300 bg-base-200 hover:border-base-content/30'}
            "
            aria-pressed={openIn === 'new-tab'}
          >
            <span class="text-base-content text-sm font-semibold"
              >{m.bookmark_open_in_new_tab()}</span
            >
            <span class="text-base-content/50 text-xs leading-tight"
              >{m.bookmark_open_in_new_tab_desc()}</span
            >
          </button>
        </div>
      </fieldset>

      <!-- Section 3 & 4: Product Name + Environment -->
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label for="{uid}-name" class="text-base-content/80 mb-1 block text-sm font-medium">
            {m.bookmark_name_label()}
          </label>
          <input
            id="{uid}-name"
            type="text"
            bind:value={name}
            oninput={handleNameInput}
            placeholder={getDefaultName()}
            class="input input-bordered w-full"
          />
        </div>
        <div>
          <label for="{uid}-env" class="text-base-content/80 mb-1 block text-sm font-medium">
            {m.bookmark_env_label()}
          </label>
          <input
            id="{uid}-env"
            type="text"
            bind:value={environment}
            placeholder={m.bookmark_env_placeholder()}
            class="input input-bordered w-full"
          />
        </div>
      </div>

      <!-- Section 5: URL -->
      <div>
        <label for="{uid}-url" class="text-base-content/80 mb-1 block text-sm font-medium">
          {m.bookmark_url_label()}
        </label>
        <input
          id="{uid}-url"
          type="url"
          bind:value={url}
          placeholder="https://superset.data-prod.corp"
          class="input input-bordered w-full"
        />
      </div>

      <!-- Section 6: Pinned checkbox -->
      <div class="relative" bind:this={pinSectionEl}>
        <label class="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            bind:this={parentPinCheckbox}
            bind:checked={pinned}
            class="checkbox checkbox-primary checkbox-sm"
          />
          <span class="text-base-content/80 text-sm"
            >{isAdmin ? m.bookmark_pinned_label() : m.bookmark_pinned_label_basic()}</span
          >
        </label>

        {#if isAdmin}
          <!-- Section 6b: Pin for everyone (admin only) -->
          <div class="mt-6 ml-8">
            <label
              for="{uid}-pin-everyone"
              class="flex items-center gap-2 {pinEveryoneDisabled
                ? 'cursor-not-allowed opacity-50'
                : 'cursor-pointer'}"
            >
              <input
                id="{uid}-pin-everyone"
                type="checkbox"
                bind:this={childPinCheckbox}
                bind:checked={pinnedForEveryone}
                disabled={pinEveryoneDisabled}
                class="checkbox checkbox-primary checkbox-sm"
              />
              <span
                class="text-sm {pinEveryoneDisabled
                  ? 'text-base-content/50'
                  : 'text-base-content/80'}">{m.bookmark_pin_everyone()}</span
              >
            </label>
            <p
              class="mt-1 text-xs {pinEveryoneDisabled
                ? 'text-base-content/40'
                : 'text-base-content/50'}"
            >
              {m.bookmark_pin_everyone_hint()}
            </p>
          </div>

          <svg
            class="pointer-events-none absolute inset-0 overflow-visible"
            fill="none"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path d={connectorPath} class="text-base-content/30" stroke-width="1.5" />
          </svg>
        {/if}
      </div>

      <!-- Section 7: Preview -->
      {#if selectedProduct}
        <div>
          <p class="text-base-content/60 mb-2 text-xs font-medium tracking-wider uppercase">
            {m.bookmark_preview_label()}
          </p>
          <div class="border-base-300 bg-base-200 flex items-center gap-3 rounded-xl border p-3">
            <div class="shrink-0">
              {#if selectedProduct.logo}
                <enhanced:img
                  src={selectedProduct.logo}
                  alt={selectedProduct.name}
                  class="size-10 rounded-xl bg-white object-contain p-1"
                  onerror={handleLogoError}
                />
                <span
                  class="flex hidden size-10 items-center justify-center rounded-xl text-sm font-bold text-white"
                  style="background-color: {selectedProduct.color}"
                >
                  {selectedProduct.initials}
                </span>
              {:else}
                <span
                  class="flex size-10 items-center justify-center rounded-xl text-sm font-bold text-white"
                  style="background-color: {selectedProduct.color}"
                >
                  {selectedProduct.initials}
                </span>
              {/if}
            </div>
            <div class="min-w-0 flex-1">
              <p class="text-base-content text-sm leading-tight font-semibold">
                {name || getDefaultName() || selectedProduct.name}
              </p>
              <div class="mt-0.5 flex flex-wrap items-center gap-1.5">
                <span class="bg-base-300 text-base-content/60 rounded-full px-2 py-0.5 text-[11px]">
                  {selectedProduct.name}
                </span>
                {#if environment}
                  <span
                    class="bg-base-300 text-base-content/60 rounded-full px-2 py-0.5 text-[11px]"
                  >
                    {environment}
                  </span>
                {/if}
              </div>
              {#if url}
                <p class="text-base-content/50 mt-0.5 truncate text-xs">{getHostname(url)}</p>
              {/if}
            </div>
          </div>
        </div>
      {/if}
    </div>

    <div class="modal-action">
      {#if isEditing}
        <button type="button" class="btn btn-error mr-auto" onclick={handleDeleteClick}>
          {m.button_delete()}
        </button>
      {/if}
      <button
        type="button"
        class="btn btn-ghost"
        onclick={() => {
          resetForm();
          open = false;
        }}
      >
        {m.button_cancel()}
      </button>
      <button
        type="button"
        class="btn btn-primary"
        disabled={!name.trim() || !url.trim()}
        onclick={handleSubmit}
      >
        {isEditing ? m.bookmark_save_changes() : m.bookmark_add_title()}
      </button>
    </div>
  </div>
</Modal>

<Modal bind:open={confirmDeleteOpen} class="modal">
  <div class="modal-box max-w-sm">
    <h3 class="text-error text-lg font-bold">{m.bookmark_delete_confirm_title()}</h3>
    <p class="text-base-content/80 mt-3 text-sm">
      {m.bookmark_delete_confirm_message({ name: bookmark?.name ?? name.trim() })}
    </p>
    <div class="modal-action">
      <button type="button" class="btn btn-ghost" onclick={handleDeleteCancel}>
        {m.button_cancel()}
      </button>
      <button type="button" class="btn btn-error" onclick={handleDeleteConfirm}>
        {m.button_delete()}
      </button>
    </div>
  </div>
</Modal>
