<script lang="ts">
  import { resolve } from '$app/paths';
  import * as m from '$lib/paraglide/messages.js';
  import IconLogout from 'virtual:icons/material-symbols/logout';
  import Dropdown from '$lib/components/ui/Dropdown.svelte';
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

<!-- A panel rather than a menu: it shows who is signed in, with one link to sign out. -->
<Dropdown
  align="end"
  popup="dialog"
  label={m.header_user_menu()}
  class="w-56 p-1"
  onopen={(panel) => panel.querySelector<HTMLElement>('a')?.focus()}
>
  {#snippet trigger(dropdown)}
    <button
      {...dropdown}
      type="button"
      class="btn btn-ghost btn-circle"
      aria-label={m.header_user_menu()}
    >
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
  {/snippet}
  <ul class="menu w-full p-0">
    <li class="menu-title">
      <p class="text-base-content truncate text-sm font-semibold">{user.name}</p>
      <p class="text-muted truncate text-xs font-normal">{user.email}</p>
    </li>
    <li class="border-base-300 mt-1 border-t pt-1">
      <a href={resolve('/auth/logout')} class="text-sm">
        <IconLogout class="h-4 w-4" aria-hidden="true" />
        {m.header_sign_out()}
      </a>
    </li>
  </ul>
</Dropdown>
