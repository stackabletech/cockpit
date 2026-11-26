<script lang="ts">
  import * as m from '$lib/paraglide/messages.js';
  import { getLocale, setLocale, locales } from '$lib/paraglide/runtime.js';
  import IconLanguage from 'virtual:icons/material-symbols/language';
  import IconCheck from 'virtual:icons/material-symbols/check';
  import Dropdown from '$lib/components/ui/Dropdown.svelte';
  import { handleMenuKeydown, menuItems } from '$lib/components/ui/menu-keyboard.js';

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

  let open = $state(false);

  function handleLocaleChange(locale: (typeof locales)[number]) {
    open = false;
    void setLocale(locale);
  }

  /** Focuses the current language when the menu opens. */
  function focusCurrent(panel: HTMLElement) {
    const items = menuItems(panel);
    (items.find((item) => item.getAttribute('aria-checked') === 'true') ?? items[0])?.focus();
  }
</script>

<Dropdown bind:open align="end" class="w-40 p-1" onopen={focusCurrent}>
  {#snippet trigger(dropdown)}
    <div
      class={showLabel ? '' : 'tooltip tooltip-bottom z-150 before:z-200'}
      data-tip={showLabel ? undefined : m.language_label()}
    >
      <button
        {...dropdown}
        type="button"
        class={`
          btn btn-ghost btn-sm
          ${showLabel ? 'gap-2' : 'btn-square'}
        `}
        aria-label={showLabel
          ? `${m.language_label()}: ${currentLocaleMeta.label()}`
          : m.language_label()}
      >
        <IconLanguage class="h-5 w-5" aria-hidden="true" />
        {#if showLabel}
          <span class="text-sm font-medium">{currentLocaleMeta.label()}</span>
        {/if}
      </button>
    </div>
  {/snippet}
  <ul
    class="menu w-full p-0"
    role="menu"
    tabindex="-1"
    aria-label={m.language_label()}
    onkeydown={(e) => handleMenuKeydown(e, e.currentTarget)}
  >
    {#each availableLocales as locale (locale.code)}
      {@const isActive = currentLocale === locale.code}
      <li role="none">
        <button
          type="button"
          role="menuitemradio"
          tabindex="-1"
          lang={locale.code}
          aria-checked={isActive}
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
</Dropdown>
