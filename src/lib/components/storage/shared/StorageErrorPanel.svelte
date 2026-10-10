<script lang="ts">
  import { resolve } from '$app/paths';
  import IconWarning from 'virtual:icons/material-symbols/warning';
  import * as m from '$lib/paraglide/messages.js';

  interface Props {
    /** HTTP status code shown as the panel heading. */
    status: number;
    /** Human-readable explanation rendered below the status code. */
    message: string;
  }

  let { status, message }: Props = $props();
</script>

<div
  class="
    flex flex-1 flex-col items-center justify-center gap-6 p-8 text-center
  "
>
  <div
    class="
      bg-error/10 text-error flex size-20 items-center justify-center
      rounded-full
    "
    aria-hidden="true"
  >
    <IconWarning class="size-10" aria-hidden="true" />
  </div>

  <div>
    <p
      class="
        text-base-content/50 mb-1 text-sm font-medium tracking-widest uppercase
      "
    >
      {m.storage_error_title()}
    </p>
    <h1 class="text-base-content text-3xl font-bold">
      {status}
    </h1>
    <p class="text-base-content/70 mt-2 max-w-sm text-sm">
      {message}
    </p>
  </div>

  <div class="flex flex-wrap items-center justify-center gap-3">
    <a href={resolve('/storage')} class="btn btn-sm btn-primary">
      {m.storage_error_back_to_storage()}
    </a>
    <button type="button" class="btn btn-ghost btn-sm" onclick={() => history.back()}>
      {m.storage_error_go_back()}
    </button>
  </div>
</div>
