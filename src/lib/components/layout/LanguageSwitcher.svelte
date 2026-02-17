<script lang="ts">
  import * as m from '$lib/paraglide/messages.js';
  import { getLocale, setLocale, locales } from '$lib/paraglide/runtime.js';

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

<details class="relative inline-block">
  <summary
    class={`btn btn-ghost btn-sm list-none [&::-webkit-details-marker]:hidden ${showLabel ? 'gap-2' : 'btn-square'}`}
    aria-label={showLabel
      ? `${m.language_label()}: ${currentLocaleMeta.label()}`
      : m.language_label()}
  >
    <svg
      class="h-5 w-5"
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20" />
      <path
        d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"
      />
    </svg>
    {#if showLabel}
      <span class="text-sm font-medium">{currentLocaleMeta.label()}</span>
    {/if}
  </summary>
  <ul
    class="menu bg-base-100 border-base-300 absolute top-full right-0 z-[999] mt-1 w-40 rounded-lg border p-1 shadow-lg"
  >
    {#each availableLocales as locale (locale.code)}
      {@const isActive = currentLocale === locale.code}
      <li>
        <button
          lang={locale.code}
          class={isActive ? 'active' : ''}
          aria-current={isActive ? 'true' : undefined}
          onclick={() => handleLocaleChange(locale.code)}
        >
          <span>{locale.label()}</span>
          {#if isActive}
            <svg
              class="h-4 w-4"
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M20 6 9 17l-5-5" />
            </svg>
          {/if}
        </button>
      </li>
    {/each}
  </ul>
</details>
