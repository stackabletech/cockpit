<script lang="ts">
  import type { Snippet } from 'svelte';
  import { resolve } from '$app/paths';
  import IconWarning from 'virtual:icons/material-symbols/warning';
  import * as m from '$lib/paraglide/messages.js';

  interface Props {
    /** HTTP status code of the error. */
    status: number;
    /** Defaults to a translated title for the status. */
    title?: string;
    /** Defaults to a translated description for the status. */
    description?: string;
    /** Present for unexpected errors (see `handleError`), so users can quote it to support. */
    requestId?: string;
    /** `h1` when rendered without the app header, which provides the page's `h1` otherwise. */
    headingLevel?: 'h1' | 'h2';
    /** Defaults to "Go to dashboard", plus "Try again" unless the page does not exist. */
    actions?: Snippet;
  }

  let { status, title, description, requestId, headingLevel = 'h2', actions }: Props = $props();

  const defaultTitle = $derived(
    status === 404
      ? m.error_not_found_title()
      : status === 403
        ? m.error_forbidden_title()
        : m.error_generic_title()
  );
  const defaultDescription = $derived(
    status === 404
      ? m.error_not_found_desc()
      : status === 403
        ? m.error_forbidden_desc()
        : m.error_generic_desc()
  );
</script>

<div class="flex flex-1 flex-col items-center justify-center gap-6 p-8 text-center">
  <div
    class="bg-error/10 text-error flex size-20 items-center justify-center rounded-full"
    aria-hidden="true"
  >
    <IconWarning class="size-10" aria-hidden="true" />
  </div>

  <div>
    <svelte:element this={headingLevel}>
      <span class="text-base-content/50 mb-1 block text-sm font-medium tracking-widest uppercase">
        {m.error_status({ status })}
      </span>
      <span class="text-base-content block text-3xl font-bold">{title ?? defaultTitle}</span>
    </svelte:element>
    <p class="text-base-content/70 mt-2 max-w-sm text-sm">{description ?? defaultDescription}</p>
    {#if requestId}
      <p class="text-base-content/60 mt-4 text-xs">
        {m.error_request_id()} <code class="select-all">{requestId}</code>
      </p>
    {/if}
  </div>

  <div class="flex flex-wrap items-center justify-center gap-3">
    {#if actions}
      {@render actions()}
    {:else}
      <a href={resolve('/(app)')} class="btn btn-sm btn-primary">{m.error_back_to_dashboard()}</a>
      {#if status !== 404}
        <button type="button" class="btn btn-ghost btn-sm" onclick={() => location.reload()}>
          {m.error_retry()}
        </button>
      {/if}
    {/if}
  </div>
</div>
