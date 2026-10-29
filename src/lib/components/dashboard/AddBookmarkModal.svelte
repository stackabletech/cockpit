<script lang="ts">
  import { untrack } from 'svelte';
  import Modal from '$lib/components/Modal.svelte';
  import { getProduct, PRODUCTS, type Product } from '$lib/dashboard/products';
  import ProductIcon from './ProductIcon.svelte';
  import {
    addBookmark,
    BookmarkRequestError,
    removeBookmark,
    updateBookmark
  } from '$lib/dashboard/bookmarks-api.js';
  import {
    BOOKMARK_LIMIT,
    BOOKMARK_MAX_LENGTH,
    bookmarkCreateSchema,
    bookmarkHostname,
    type Bookmark
  } from '$lib/dashboard/types';
  import * as m from '$lib/paraglide/messages.js';
  import IconClose from 'virtual:icons/material-symbols/close';

  let {
    open = $bindable(false),
    bookmark = null
  }: {
    open: boolean;
    bookmark?: Bookmark | null;
  } = $props();

  let selectedProduct = $state<Product>(PRODUCTS[0]);
  let name = $state('');
  let userEditedName = $state(false);
  let environment = $state('');
  let url = $state('');
  let pinned = $state(false);
  let confirmDeleteOpen = $state(false);
  let wasOpen = false;
  let nameError = $state(false);
  let urlError = $state(false);
  let saving = $state(false);
  let requestError = $state<string | null>(null);

  let uid = $props.id();

  let isEditing = $derived(bookmark !== null);

  function initForm(target: Bookmark | null) {
    selectedProduct = target ? getProduct(target.productId) : PRODUCTS[0];
    name = target?.name ?? selectedProduct.defaultName;
    userEditedName = target !== null;
    environment = target?.environment ?? '';
    url = target?.url ?? '';
    pinned = target?.pinned ?? false;
    nameError = false;
    urlError = false;
    requestError = null;
  }

  // Only `open` is tracked; the bookmark is read once per open.
  $effect(() => {
    const opening = open && !wasOpen;
    wasOpen = open;
    if (opening) untrack(() => initForm(bookmark));
  });

  function handleProductSelect(product: Product) {
    selectedProduct = product;
    if (!userEditedName) {
      name = product.defaultName;
    }
  }

  function handleNameInput() {
    // Clearing the name hands it back to the product default on the next product switch.
    userEditedName = name.trim() !== '';
    nameError = false;
  }

  function handleUrlInput() {
    urlError = false;
  }

  function isValidUrl(value: string): boolean {
    return bookmarkCreateSchema.shape.url.safeParse(value.trim()).success;
  }

  function handleUrlBlur() {
    if (url.trim()) urlError = !isValidUrl(url);
  }

  /**
   * Runs a bookmark request; closes the dialog on success, otherwise shows
   * `errorMessage`, or the limit when the server rejects another bookmark.
   */
  async function save(request: () => Promise<void>, errorMessage: string) {
    saving = true;
    requestError = null;
    try {
      await request();
      open = false;
    } catch (err) {
      requestError =
        err instanceof BookmarkRequestError && err.status === 409
          ? m.bookmark_limit_error({ limit: BOOKMARK_LIMIT })
          : errorMessage;
    } finally {
      saving = false;
    }
  }

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    if (saving) return;
    const values = {
      productId: selectedProduct.id,
      name: name.trim(),
      environment: environment.trim(),
      url: url.trim(),
      pinned
    };
    const parsed = bookmarkCreateSchema.safeParse(values);
    if (!parsed.success) {
      nameError = !values.name;
      urlError = !isValidUrl(values.url);
      document.getElementById(nameError ? `${uid}-name` : `${uid}-url`)?.focus();
      return;
    }

    const target = bookmark;
    await save(
      () => (target ? updateBookmark(target.id, parsed.data) : addBookmark(parsed.data)),
      m.bookmark_save_error()
    );
  }

  function close() {
    if (!saving) open = false;
  }

  // The confirmation opens on top of the edit dialog, so cancelling (or Escape)
  // returns to the form with the user's unsaved edits intact.
  function handleDeleteClick() {
    if (saving) return;
    confirmDeleteOpen = true;
  }

  function handleDeleteCancel() {
    confirmDeleteOpen = false;
  }

  async function handleDeleteConfirm() {
    const target = bookmark;
    if (!target || saving) return;
    // Back to the edit dialog, which shows the error if the delete fails.
    confirmDeleteOpen = false;
    await save(() => removeBookmark(target.id), m.bookmark_delete_error());
  }
</script>

<!-- Not closable while a request runs, so its result cannot land on a reopened form. -->
<Modal bind:open dismissible={!saving} aria-labelledby="{uid}-title">
  <div class="modal-box max-w-2xl">
    <button
      type="button"
      class="btn btn-sm btn-circle btn-ghost absolute top-2 right-2"
      class:btn-disabled={saving}
      aria-label={m.action_close()}
      aria-disabled={saving}
      onclick={close}
    >
      <IconClose class="size-5" aria-hidden="true" />
    </button>

    <h3 id="{uid}-title" class="text-base-content text-lg font-bold">
      {isEditing ? m.bookmark_edit_title() : m.bookmark_add_title()}
    </h3>

    <!-- novalidate: the inline errors replace the browser's own URL validation. -->
    <form novalidate onsubmit={handleSubmit}>
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
                <ProductIcon {product} />
                {product.name}
              </button>
            {/each}
          </div>
        </fieldset>

        <!-- Product name and environment -->
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
              maxlength={BOOKMARK_MAX_LENGTH.name}
              placeholder={selectedProduct.defaultName}
              class="input w-full"
              aria-invalid={nameError}
              aria-describedby={nameError ? `${uid}-name-error` : undefined}
            />
            {#if nameError}
              <p id="{uid}-name-error" class="text-error mt-1 text-sm">{m.bookmark_name_error()}</p>
            {/if}
          </div>
          <div>
            <label for="{uid}-env" class="text-base-content/80 mb-1 block text-sm font-medium">
              {m.bookmark_env_label()}
            </label>
            <input
              id="{uid}-env"
              type="text"
              bind:value={environment}
              maxlength={BOOKMARK_MAX_LENGTH.environment}
              placeholder={m.bookmark_env_placeholder()}
              class="input w-full"
            />
          </div>
        </div>

        <!-- URL -->
        <div>
          <label for="{uid}-url" class="text-base-content/80 mb-1 block text-sm font-medium">
            {m.bookmark_url_label()}
          </label>
          <input
            id="{uid}-url"
            type="url"
            bind:value={url}
            oninput={handleUrlInput}
            onblur={handleUrlBlur}
            maxlength={BOOKMARK_MAX_LENGTH.url}
            placeholder={m.bookmark_url_placeholder()}
            class="input w-full"
            aria-invalid={urlError}
            aria-describedby={urlError ? `${uid}-url-error` : undefined}
          />
          {#if urlError}
            <p id="{uid}-url-error" class="text-error mt-1 text-sm">{m.bookmark_url_error()}</p>
          {/if}
        </div>

        <!-- Pinned checkbox -->
        <label for="{uid}-pin" class="flex cursor-pointer items-center gap-2">
          <input
            id="{uid}-pin"
            type="checkbox"
            bind:checked={pinned}
            class="checkbox checkbox-primary checkbox-sm"
          />
          <span class="text-base-content/80 text-sm">{m.bookmark_pin_label()}</span>
        </label>

        <!-- Preview -->
        <div>
          <p class="text-muted mb-2 text-xs font-medium tracking-wider uppercase">
            {m.bookmark_preview_label()}
          </p>
          <div class="border-base-300 bg-base-200 flex items-center gap-3 rounded-xl border p-3">
            <div class="shrink-0">
              <ProductIcon product={selectedProduct} size="lg" />
            </div>
            <div class="min-w-0 flex-1">
              <p class="text-base-content text-sm leading-tight font-semibold">
                {name || selectedProduct.defaultName || selectedProduct.name}
              </p>
              <div class="mt-0.5 flex flex-wrap items-center gap-1.5">
                <span class="bg-base-300 text-muted rounded-full px-2 py-0.5 text-[11px]">
                  {selectedProduct.name}
                </span>
                {#if environment}
                  <span class="bg-base-300 text-muted rounded-full px-2 py-0.5 text-[11px]">
                    {environment}
                  </span>
                {/if}
              </div>
              {#if url}
                <p class="text-muted mt-0.5 truncate text-xs">
                  {bookmarkHostname(url)}
                </p>
              {/if}
            </div>
          </div>
        </div>
      </div>

      {#if requestError}
        <div role="alert" class="alert alert-error mt-6 text-sm">{requestError}</div>
      {/if}
      <!-- The spinner is decorative; this announces the save to screen readers. -->
      <p role="status" class="sr-only">{saving ? m.bookmark_saving() : ''}</p>

      <div class="modal-action">
        {#if isEditing}
          <button
            type="button"
            class="btn btn-error mr-auto"
            class:btn-disabled={saving}
            aria-disabled={saving}
            onclick={handleDeleteClick}
          >
            {m.bookmark_delete()}
          </button>
        {/if}
        <button
          type="button"
          class="btn btn-ghost"
          class:btn-disabled={saving}
          aria-disabled={saving}
          onclick={close}
        >
          {m.bookmark_cancel()}
        </button>
        <button
          type="submit"
          class="btn btn-primary"
          class:btn-disabled={saving}
          aria-disabled={saving}
        >
          {#if saving}
            <span class="loading loading-spinner loading-sm" aria-hidden="true"></span>
          {/if}
          {isEditing ? m.bookmark_save_changes() : m.bookmark_add_title()}
        </button>
      </div>
    </form>
  </div>
</Modal>

<Modal bind:open={confirmDeleteOpen} aria-labelledby="{uid}-delete-title">
  <div class="modal-box max-w-sm">
    <h3 id="{uid}-delete-title" class="text-error text-lg font-bold">
      {m.bookmark_delete_confirm_title()}
    </h3>
    <p class="text-base-content/80 mt-3 text-sm">
      {m.bookmark_delete_confirm_message({ name: bookmark?.name ?? name.trim() })}
    </p>
    <div class="modal-action">
      <button type="button" class="btn btn-ghost" onclick={handleDeleteCancel}>
        {m.bookmark_cancel()}
      </button>
      <button type="button" class="btn btn-error" onclick={handleDeleteConfirm}>
        {m.bookmark_delete()}
      </button>
    </div>
  </div>
</Modal>
