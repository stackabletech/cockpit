<script lang="ts">
  import * as m from '$lib/paraglide/messages.js';
  import { getLocale, setLocale, locales } from '$lib/paraglide/runtime.js';
  import IconLanguage from 'virtual:icons/material-symbols/language';
  import IconCheck from 'virtual:icons/material-symbols/check';

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
  class={`
    btn btn-ghost btn-sm
    ${showLabel ? 'gap-2' : 'btn-square'}
  `}
  popovertarget="lang-switcher"
  style="anchor-name:--lang-switcher"
  aria-label={showLabel
    ? `${m.language_label()}: ${currentLocaleMeta.label()}`
    : m.language_label()}
>
  <IconLanguage class="h-5 w-5" aria-hidden="true" />
  {#if showLabel}
    <span class="text-sm font-medium">{currentLocaleMeta.label()}</span>
  {/if}
</button>
<ul
  class="
    menu dropdown dropdown-end border-base-300 bg-base-100 w-40 rounded-lg
    border p-1 shadow-lg
  "
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
          <IconCheck class="h-4 w-4" aria-hidden="true" />
        {/if}
      </button>
    </li>
  {/each}
</ul>
