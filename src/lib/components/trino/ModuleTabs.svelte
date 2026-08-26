<script lang="ts">
  import { resolveRoute } from '$app/paths';
  import { page } from '$app/state';
  import * as m from '$lib/paraglide/messages.js';

  const tabs = $derived([
    {
      href: '/trino' as const,
      label: m.sql_diagram_tab_editor(),
      active: page.url.pathname === '/trino'
    },
    {
      href: '/sql-diagram' as const,
      label: m.sql_diagram_tab_builder(),
      active: page.url.pathname === '/sql-diagram'
    }
  ]);
</script>

<!-- eslint-disable svelte/no-navigation-without-resolve -->
<nav class="px-2 pt-1" aria-label={m.sql_diagram_module_tabs_label()}>
  <div class="border-base-300 bg-base-100 inline-flex rounded-xl border p-1">
    {#each tabs as tab (tab.href)}
      <a
        href={resolveRoute(tab.href)}
        class="rounded-lg px-4 py-1.5 text-sm font-medium transition-colors
          {tab.active
          ? 'bg-primary/10 text-primary'
          : 'text-base-content/70 hover:bg-base-content/5 hover:text-base-content'}"
        aria-current={tab.active ? 'page' : undefined}
      >
        {tab.label}
      </a>
    {/each}
  </div>
</nav>
<!-- eslint-enable svelte/no-navigation-without-resolve -->
