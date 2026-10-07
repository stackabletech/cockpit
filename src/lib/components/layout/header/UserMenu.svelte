<script lang="ts">
  import { resolve } from '$app/paths';
  import * as m from '$lib/paraglide/messages.js';
  import IconLogout from 'virtual:icons/material-symbols/logout';
  import type { User } from '$lib/types/auth.js';

  let { user }: { user: User } = $props();

  const initials = $derived(
    user.name
      ? user.name
          .split(' ')
          .map((n) => n[0])
          .join('')
          .toUpperCase()
          .slice(0, 2)
      : '?'
  );
</script>

<div class="dropdown dropdown-end">
  <button tabindex="0" class="btn btn-ghost btn-circle" aria-label={m.header_user_menu()}>
    {#if user.image}
      <img src={user.image} alt={user.name ?? ''} class="h-8 w-8 rounded-full object-cover" />
    {:else}
      <span
        class="bg-primary/10 text-primary flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold"
        aria-hidden="true"
      >
        {initials}
      </span>
    {/if}
  </button>
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <ul
    tabindex="0"
    class="dropdown-content menu bg-base-100 border-base-300 z-10 w-56 rounded-lg border p-1 shadow-lg"
  >
    <li class="px-3 py-2">
      <p class="text-base-content truncate text-sm font-semibold">{user.name}</p>
      <p class="text-base-content/60 truncate text-xs">{user.email}</p>
    </li>
    <li><hr class="border-base-300 my-1" /></li>
    <li class="mt-4">
      <a href={resolve('/auth/logout')} class="text-sm">
        <IconLogout class="h-4 w-4" aria-hidden="true" />
        {m.header_sign_out()}
      </a>
    </li>
  </ul>
</div>
