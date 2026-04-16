<script lang="ts">
  import { untrack } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import * as m from '$lib/paraglide/messages.js';
  import CatalogTree from './CatalogTree.svelte';
  import type { TreeNode } from './types.js';

  let {
    connectionVersion = 0,
    defaultCatalog = $bindable(''),
    defaultSchema = $bindable(''),
    onInsert
  }: {
    connectionVersion: number;
    defaultCatalog: string;
    defaultSchema: string;
    onInsert: (qualifiedName: string) => void;
  } = $props();

  const uid = $props.id();

  let catalogs = $state<TreeNode[]>([]);
  let expanded = new SvelteSet<string>();
  let loadError = $state<string | null>(null);
  let catalogsLoading = $state(false);

  // Available schemas for the context selector dropdown.
  let availableSchemas = $state<string[]>([]);

  async function fetchLevel(params: Record<string, string>): Promise<unknown[][]> {
    const qs = new URLSearchParams(params).toString();
    const res = await fetch(`/trino/catalog?${qs}`);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text);
    }
    return res.json();
  }

  async function loadCatalogs() {
    catalogsLoading = true;
    loadError = null;
    try {
      const rows = await fetchLevel({ level: 'catalogs' });
      catalogs = rows.map((row) => ({
        name: String((row as string[])[0]),
        type: 'catalog' as const
      }));
    } catch (err) {
      loadError = err instanceof Error ? err.message : m.trino_catalog_error();
      catalogs = [];
    } finally {
      catalogsLoading = false;
    }
  }

  async function loadSchemas(catalogName: string): Promise<TreeNode[]> {
    const rows = await fetchLevel({ level: 'schemas', catalog: catalogName });
    return rows.map((row) => ({
      name: String((row as string[])[0]),
      type: 'schema' as const
    }));
  }

  async function loadTables(catalogName: string, schemaName: string): Promise<TreeNode[]> {
    const rows = await fetchLevel({
      level: 'tables',
      catalog: catalogName,
      schema: schemaName
    });
    return rows.map((row) => {
      const arr = row as string[];
      let type: TreeNode['type'];
      switch ((arr[1] ?? '').toUpperCase()) {
        case 'MATERIALIZED VIEW':
          type = 'materialized_view';
          break;
        case 'VIEW':
          type = 'view';
          break;
        default:
          type = 'table';
      }
      return { name: String(arr[0]), type };
    });
  }

  async function loadColumns(
    catalogName: string,
    schemaName: string,
    tableName: string
  ): Promise<TreeNode[]> {
    const rows = await fetchLevel({
      level: 'columns',
      catalog: catalogName,
      schema: schemaName,
      table: tableName
    });
    return rows.map((row) => {
      const arr = row as string[];
      return {
        name: String(arr[0]),
        type: 'column' as const,
        dataType: String(arr[1])
      };
    });
  }

  function findNode(path: string): TreeNode | undefined {
    const parts = path.split('.');
    let nodes = catalogs;
    let node: TreeNode | undefined;
    for (const part of parts) {
      node = nodes.find((n) => n.name === part);
      if (!node) return undefined;
      nodes = node.children ?? [];
    }
    return node;
  }

  function handleToggle(path: string) {
    if (expanded.has(path)) {
      expanded.delete(path);
    } else {
      expanded.add(path);
    }
  }

  async function handleLoadChildren(path: string, node: TreeNode) {
    if (node.children) return;

    const parts = path.split('.');
    node.loading = true;
    catalogs = [...catalogs]; // Trigger reactivity.

    try {
      let children: TreeNode[];
      if (node.type === 'catalog') {
        children = await loadSchemas(parts[0]);
      } else if (node.type === 'schema') {
        children = await loadTables(parts[0], parts[1]);
      } else if (
        node.type === 'table' ||
        node.type === 'view' ||
        node.type === 'materialized_view'
      ) {
        children = await loadColumns(parts[0], parts[1], parts[2]);
      } else {
        children = [];
      }

      // Find the node again (reference may have changed due to reactivity).
      const found = findNode(path);
      if (found) {
        found.children = children;
        found.loading = false;
      }
    } catch {
      const found = findNode(path);
      if (found) {
        found.children = [];
        found.loading = false;
        found.error = true;
      }
    }

    catalogs = [...catalogs]; // Trigger reactivity.
  }

  // Reload catalogs whenever the connection version bumps (i.e. after save).
  $effect(() => {
    // Read connectionVersion to subscribe to changes.
    if (connectionVersion > 0) {
      loadCatalogs();
    }
  });

  // When default catalog changes, load its schemas for the dropdown.
  // untrack() is required: loadSchemas() internally reads connectionUrl,
  // authType, etc. via buildQueryParams. Without untrack, this effect
  // would also re-run on connection changes, duplicating Effect 1 above.
  // State writes happen inside the async .then() callback to avoid
  // synchronous writes during effect execution (which cause cascading
  // update warnings). The empty-catalog case is handled by
  // handleCatalogChange; initial values are already empty.
  $effect(() => {
    const catalog = defaultCatalog;
    untrack(() => {
      if (catalog) {
        loadSchemas(catalog).then((schemaNodes) => {
          availableSchemas = schemaNodes.map((n) => n.name);
          if (defaultSchema && !availableSchemas.includes(defaultSchema)) {
            defaultSchema = '';
          }
        });
      }
    });
  });

  function handleRefresh() {
    expanded.clear();
    loadCatalogs();
  }

  function handleCatalogChange(event: Event) {
    defaultCatalog = (event.target as HTMLSelectElement).value;
    defaultSchema = '';
    availableSchemas = [];
  }

  function handleSchemaChange(event: Event) {
    defaultSchema = (event.target as HTMLSelectElement).value;
  }
</script>

<nav class="flex h-full flex-col overflow-hidden" aria-label={m.trino_catalog_browser()}>
  <!-- Schema context selector -->
  <div class="border-base-300 flex flex-col gap-2 border-b p-3">
    <div class="flex flex-col gap-1">
      <label for="{uid}-catalog" class="text-base-content/60 text-xs font-medium">
        {m.trino_default_catalog()}
      </label>
      <select
        id="{uid}-catalog"
        class="select select-sm w-full"
        value={defaultCatalog}
        onchange={handleCatalogChange}
      >
        <option value="">-</option>
        {#each catalogs as cat (cat.name)}
          <option value={cat.name}>{cat.name}</option>
        {/each}
      </select>
    </div>
    <div class="flex flex-col gap-1">
      <label for="{uid}-schema" class="text-base-content/60 text-xs font-medium">
        {m.trino_default_schema()}
      </label>
      <select
        id="{uid}-schema"
        class="select select-sm w-full"
        value={defaultSchema}
        onchange={handleSchemaChange}
        disabled={!defaultCatalog}
      >
        <option value="">-</option>
        {#each availableSchemas as schema (schema)}
          <option value={schema}>{schema}</option>
        {/each}
      </select>
    </div>
  </div>

  <!-- Tree view -->
  <div class="border-base-300 flex items-center justify-between border-b px-3 py-1">
    <span class="text-base-content/60 text-xs font-medium">{m.trino_catalog_browser()}</span>
    <button
      class="btn btn-ghost btn-xs"
      aria-label={m.trino_catalog_refresh()}
      title={m.trino_catalog_refresh()}
      onclick={handleRefresh}
      disabled={catalogsLoading}
    >
      <svg
        class="h-3.5 w-3.5"
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
        <path d="M21 3v5h-5" />
      </svg>
    </button>
  </div>
  <div class="min-h-0 flex-1 overflow-auto p-2">
    {#if catalogsLoading}
      <div class="flex items-center gap-2 p-2">
        <span class="loading loading-spinner loading-xs"></span>
        <span class="text-base-content/40 text-sm">{m.trino_loading()}</span>
      </div>
    {:else if loadError}
      <div class="text-error p-2 text-sm">
        <p>{m.trino_catalog_error()}</p>
        <p class="text-xs opacity-70">{loadError}</p>
      </div>
    {:else if catalogs.length === 0}
      <p class="text-base-content/40 p-2 text-sm">{m.trino_no_catalogs()}</p>
    {:else}
      <CatalogTree
        nodes={catalogs}
        {expanded}
        onToggle={handleToggle}
        {onInsert}
        onLoadChildren={handleLoadChildren}
      />
    {/if}
  </div>
</nav>
