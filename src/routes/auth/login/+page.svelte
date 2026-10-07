<script lang="ts">
  import * as m from '$lib/paraglide/messages.js';
  import { authClient } from '$lib/auth-client.js';
  import IconWarning from 'virtual:icons/material-symbols/warning';
  import IconLock from 'virtual:icons/material-symbols/lock-outline';

  let { data } = $props();

  let loading = $state(false);
  let error = $state<string | null>(null);

  async function handleSignIn() {
    loading = true;
    error = null;

    const result = await authClient.signIn.oauth2({
      providerId: 'oidc',
      callbackURL: data.redirectTo
    });

    if (result?.error) {
      error = m.auth_login_error();
      loading = false;
    }
  }
</script>

<svelte:head>
  <title>{m.auth_login_title()} | {m.page_title_suffix()}</title>
</svelte:head>

<div class="bg-base-200 flex min-h-dvh items-center justify-center p-4">
  <div
    class="
    card border-base-300 bg-base-100 w-full max-w-sm border shadow-xl
  "
  >
    <div class="card-body items-center text-center">
      <div class="mb-2">
        <IconLock class="text-primary mx-auto size-12" aria-hidden="true" />
      </div>

      <h1 class="card-title text-2xl">{m.auth_login_title()}</h1>
      <p class="text-base-content/60 text-sm">{m.auth_login_subtitle()}</p>

      {#if error}
        <div role="alert" class="alert alert-error mt-2 w-full text-sm">
          <IconWarning class="size-5" aria-hidden="true" />
          <span>{error}</span>
        </div>
      {/if}

      <div class="card-actions mt-4 w-full">
        <button
          class="btn btn-primary w-full"
          onclick={handleSignIn}
          disabled={loading}
          aria-busy={loading}
        >
          {#if loading}
            <span class="loading loading-sm loading-spinner" aria-hidden="true"></span>
          {/if}
          {m.auth_login_button()}
        </button>
      </div>
    </div>
  </div>
</div>
