<script lang="ts">
  import * as m from '$lib/paraglide/messages.js';
  import IconChevronRight from 'virtual:icons/material-symbols/chevron-right';
  import IconCatalog from 'virtual:icons/material-symbols/database-outline';
  import IconSchema from 'virtual:icons/material-symbols/folder-outline';
  import IconTable from 'virtual:icons/material-symbols/table-outline';
  import IconView from 'virtual:icons/material-symbols/visibility-outline';
  import IconMaterializedView from 'virtual:icons/material-symbols/preview-outline';
  import IconColumn from 'virtual:icons/material-symbols/circle';
  import type { TreeNode } from './types.js';
  import CatalogTree from './CatalogTree.svelte';

  let {
    nodes,
    level = 0,
    parentPath = '',
    expanded,
    onToggle,
    onInsert,
    onLoadChildren
  }: {
    nodes: TreeNode[];
    level?: number;
    parentPath?: string;
    expanded: Set<string>;
    onToggle: (path: string) => void;
    onInsert: (qualifiedName: string) => void;
    onLoadChildren: (path: string, node: TreeNode) => void;
  } = $props();

  function nodePath(name: string): string {
    return parentPath ? `${parentPath}.${name}` : name;
  }

  function isLeaf(node: TreeNode): boolean {
    return node.type === 'column';
  }

  function handleToggle(node: TreeNode) {
    const path = nodePath(node.name);
    onToggle(path);
    if (!expanded.has(path) || node.children) return;
    onLoadChildren(path, node);
  }

  function handleInsert(node: TreeNode) {
    const path = nodePath(node.name);
    onInsert(path);
  }

  function handleKeydown(event: KeyboardEvent, node: TreeNode) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (isLeaf(node)) return;
      handleToggle(node);
    }
  }
</script>

{#snippet chevronIcon(isOpen: boolean)}
  <IconChevronRight
    class="h-3.5 w-3.5 shrink-0 transition-transform duration-150 {isOpen ? 'rotate-90' : ''}"
    aria-hidden="true"
  />
{/snippet}

{#snippet nodeIcon(type: string)}
  {#if type === 'catalog'}
    <IconCatalog class="text-base-content/50 h-4 w-4 shrink-0" aria-hidden="true" />
  {:else if type === 'schema'}
    <IconSchema class="text-base-content/50 h-4 w-4 shrink-0" aria-hidden="true" />
  {:else if type === 'table'}
    <IconTable class="text-base-content/50 h-4 w-4 shrink-0" aria-hidden="true" />
  {:else if type === 'view'}
    <IconView class="text-base-content/50 h-4 w-4 shrink-0" aria-hidden="true" />
  {:else if type === 'materialized_view'}
    <IconMaterializedView class="text-base-content/50 h-4 w-4 shrink-0" aria-hidden="true" />
  {:else}
    <IconColumn class="text-base-content/40 h-3 w-3 shrink-0" aria-hidden="true" />
  {/if}
{/snippet}

<ul role={level === 0 ? 'tree' : 'group'} class={level > 0 ? 'ml-4' : ''}>
  {#each nodes as node (node.name)}
    {@const path = nodePath(node.name)}
    {@const isExpanded = expanded.has(path)}
    {@const leaf = isLeaf(node)}
    <li
      role="treeitem"
      aria-expanded={leaf ? undefined : isExpanded}
      aria-selected="false"
      class="select-none"
    >
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <div
        class="hover:bg-base-200 flex items-center gap-1 rounded px-1 py-0.5 text-sm {leaf
          ? ''
          : 'cursor-pointer'}"
        onclick={() => (leaf ? null : handleToggle(node))}
        onkeydown={(e) => (!leaf ? handleKeydown(e, node) : undefined)}
        tabindex={leaf ? undefined : 0}
        role={leaf ? undefined : 'button'}
        aria-label={leaf ? `${node.name} (${node.dataType ?? ''})` : node.name}
      >
        {#if !leaf}
          <span class="text-base-content/40 flex w-4 items-center justify-center">
            {@render chevronIcon(isExpanded)}
          </span>
        {:else}
          <span class="w-4" aria-hidden="true"></span>
        {/if}

        {@render nodeIcon(node.type)}

        {#if node.type === 'table' || node.type === 'view' || node.type === 'materialized_view'}
          <button
            class="hover:text-primary min-w-0 truncate text-left hover:underline"
            onclick={(e) => {
              e.stopPropagation();
              handleInsert(node);
            }}
            title={m.trino_insert_table()}
            aria-label="{m.trino_insert_table()}: {path}"
          >
            {node.name}
          </button>
          <span class="badge badge-ghost badge-xs text-base-content/40 whitespace-nowrap">
            {#if node.type === 'materialized_view'}
              {m.trino_table_type_materialized_view()}
            {:else if node.type === 'view'}
              {m.trino_table_type_view()}
            {:else}
              {m.trino_table_type_table()}
            {/if}
          </span>
        {:else}
          <span class="min-w-0 truncate">{node.name}</span>
        {/if}

        {#if leaf && node.dataType}
          <span class="text-base-content/40 ml-auto font-mono text-xs">{node.dataType}</span>
        {/if}
      </div>

      {#if node.loading}
        <div class="ml-8 py-1">
          <span class="loading loading-spinner loading-xs"></span>
          <span class="text-base-content/40 text-xs">{m.trino_loading()}</span>
        </div>
      {/if}

      {#if isExpanded && node.error}
        <div class="text-error ml-8 py-1 text-xs">{m.trino_catalog_load_children_error()}</div>
      {/if}

      {#if isExpanded && node.children && node.children.length > 0}
        <CatalogTree
          nodes={node.children}
          level={level + 1}
          parentPath={path}
          {expanded}
          {onToggle}
          {onInsert}
          {onLoadChildren}
        />
      {/if}
    </li>
  {/each}
</ul>
