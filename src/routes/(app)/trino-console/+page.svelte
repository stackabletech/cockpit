<script lang="ts">
  import { browser } from '$app/environment';
  import { env } from '$env/dynamic/public';
  import * as m from '$lib/paraglide/messages.js';

  // Layer 2 spike (iframe-spike §5.1): embed the Trino Web UI full-page inside Cockpit.
  // Same-site (trino.sdp.test under the shared parent) so the Dex session is first-party here.
  const trinoUiUrl = env.PUBLIC_STACKABLE_COCKPIT_TRINO_UI_URL;
  const trinoOrigin = trinoUiUrl ? new URL(trinoUiUrl).origin : '';
  // Shared parent domain (e.g. sdp.test) so the theme cookie is readable by the Trino subdomain.
  const cookieDomain = trinoUiUrl ? new URL(trinoUiUrl).hostname.split('.').slice(1).join('.') : '';

  let iframeEl = $state<HTMLIFrameElement | undefined>();

  function currentTheme(): string {
    return browser ? (document.documentElement.getAttribute('data-theme') ?? 'light') : 'light';
  }

  // Trino's UI is statically dark and can't follow Cockpit's toggle. We only need to suppress its
  // white FOUC when Cockpit is dark, so we publish Cockpit's current theme to the Trino subdomain:
  //  - a cookie on the shared parent domain, read synchronously by the injected script on each
  //    Trino page load (kills the flash on drill-down navigation);
  //  - a postMessage for a live toggle while the frame is open.
  function syncTheme() {
    if (!browser || !trinoUiUrl) return;
    const theme = currentTheme();
    document.cookie = `cockpit_theme=${theme}; domain=${cookieDomain}; path=/; SameSite=Lax`;
    iframeEl?.contentWindow?.postMessage({ type: 'cockpit-theme', theme }, trinoOrigin);
  }

  // Set the cookie during setup, before the iframe starts loading, so the first paint matches too.
  if (browser) syncTheme();

  $effect(() => {
    if (!browser) return;
    syncTheme();
    const observer = new MutationObserver(syncTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme']
    });
    return () => observer.disconnect();
  });
</script>

{#if trinoUiUrl}
  <div class="h-full">
    <iframe
      bind:this={iframeEl}
      src={trinoUiUrl}
      title={m.trino_console_iframe_title()}
      onload={syncTheme}
      class="border-base-300 bg-base-100 rounded-box h-full w-full border"
    ></iframe>
  </div>
{:else}
  <div class="alert alert-warning" role="alert">
    <span>{m.trino_console_unconfigured()}</span>
  </div>
{/if}
