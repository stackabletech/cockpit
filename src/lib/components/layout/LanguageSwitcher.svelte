<script lang="ts">
  import * as m from '$lib/paraglide/messages.js';
  import { getLocale, setLocale, locales } from '$lib/paraglide/runtime.js';
  import Icon from '@iconify/svelte';

  type LocaleMeta = {
    code: (typeof locales)[number];
    label: () => string;
  };

  const availableLocales: LocaleMeta[] = [
    { code: 'en', label: () => m.language_en() },
    { code: 'de', label: () => m.language_de() }
  ];

  let { showLabel = false }: { showLabel?: boolean } = $props();

  const currentLocale = $derived(getLocale());
  const currentLocaleMeta = $derived(
    availableLocales.find((locale) => locale.code === currentLocale) ?? availableLocales[0]
  );

  function handleLocaleChange(locale: (typeof locales)[number]) {
    setLocale(locale);
  }
</script>

<button
  class={`btn btn-ghost btn-sm ${showLabel ? 'gap-2' : 'btn-square'}`}
  popovertarget="lang-switcher"
  style="anchor-name:--lang-switcher"
  aria-label={showLabel
    ? `${m.language_label()}: ${currentLocaleMeta.label()}`
    : m.language_label()}
>
  <Icon icon="material-symbols:language" class="h-5 w-5" aria-hidden="true" />
  {#if showLabel}
    <span class="text-sm font-medium">{currentLocaleMeta.label()}</span>
  {/if}
</button>
<ul
  class="dropdown dropdown-end menu bg-base-100 border-base-300 w-40 rounded-lg border p-1 shadow-lg"
  popover
  id="lang-switcher"
  style="position-anchor:--lang-switcher"
>
  {#each availableLocales as locale (locale.code)}
    {@const isActive = currentLocale === locale.code}
    <li>
      <button
        lang={locale.code}
        aria-current={isActive ? 'true' : undefined}
        onclick={() => handleLocaleChange(locale.code)}
      >
        <span>{locale.label()}</span>
        {#if isActive}
          <Icon icon="material-symbols:check" class="h-4 w-4" aria-hidden="true" />
        {/if}
      </button>
    </li>
  {/each}
</ul>
