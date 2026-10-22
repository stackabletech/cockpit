<script lang="ts">
  import { page } from '$app/state';
  import { resolve } from '$app/paths';
  import IconLogin from 'virtual:icons/material-symbols/login';
  import * as m from '$lib/paraglide/messages.js';
  import Modal from '$lib/components/Modal.svelte';
  import { checkSession, sessionState } from '$lib/client/session.svelte';

  const SESSION_CHECK_INTERVAL_MS = 60_000;

  const uid = $props.id();

  let redirectTo = $derived(encodeURIComponent(page.url.pathname + page.url.search));

  // Enable session checks while mounted, so an expired session is noticed
  // before the next API call: periodically while the tab is visible, and when
  // the user returns to it. Checks do not extend the session, so polling does
  // not keep an idle tab signed in.
  $effect(() => {
    sessionState.active = true;
    const checkIfVisible = () => {
      if (document.visibilityState === 'visible') void checkSession();
    };
    document.addEventListener('visibilitychange', checkIfVisible);
    const interval = setInterval(checkIfVisible, SESSION_CHECK_INTERVAL_MS);
    return () => {
      sessionState.active = false;
      document.removeEventListener('visibilitychange', checkIfVisible);
      clearInterval(interval);
    };
  });
</script>

<Modal
  bind:open={sessionState.expired}
  dismissible={false}
  aria-labelledby="{uid}-title"
  aria-describedby="{uid}-message"
>
  <div class="modal-box max-w-md">
    <h2 id="{uid}-title" class="text-lg font-bold">{m.session_expired_title()}</h2>
    <p id="{uid}-message" class="text-base-content/70 py-4">{m.session_expired_message()}</p>
    <div class="modal-action">
      <!-- The path is resolved; the rule does not recognise the appended query string. -->
      <!-- eslint-disable svelte/no-navigation-without-resolve -->
      <a
        href={`${resolve('/auth/login')}?redirectTo=${redirectTo}`}
        class="btn btn-primary"
        data-sveltekit-reload
      >
        <!-- eslint-enable svelte/no-navigation-without-resolve -->
        <IconLogin class="size-5" aria-hidden="true" />
        {m.session_expired_sign_in()}
      </a>
    </div>
  </div>
</Modal>
