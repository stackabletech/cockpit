<script lang="ts">
  import * as m from '$lib/paraglide/messages.js';
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
  <svg
    class="h-3.5 w-3.5 shrink-0 transition-transform duration-150 {isOpen ? 'rotate-90' : ''}"
    aria-hidden="true"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path d="m9 5 7 7-7 7" />
  </svg>
{/snippet}

{#snippet nodeIcon(type: string)}
  {#if type === 'catalog'}
    <svg
      class="text-base-content/50 h-4 w-4 shrink-0"
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5" />
      <path d="M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3" />
    </svg>
  {:else if type === 'schema'}
    <svg
      class="text-base-content/50 h-4 w-4 shrink-0"
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path
        d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"
      />
    </svg>
  {:else if type === 'table'}
    <svg
      class="text-base-content/50 h-4 w-4 shrink-0"
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18" />
      <path d="M3 15h18" />
      <path d="M9 3v18" />
    </svg>
  {:else if type === 'view'}
    <svg
      class="text-base-content/50 h-4 w-4 shrink-0"
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path
        d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"
      />
      <circle cx="12" cy="12" r="3" />
    </svg>
  {:else if type === 'materialized_view'}
    <svg
      class="text-base-content/50 h-4 w-4 shrink-0"
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path
        d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"
      />
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v4" />
      <path d="M12 18v4" />
    </svg>
  {:else}
    <svg
      class="text-base-content/40 h-3 w-3 shrink-0"
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="currentColor"
    >
      <circle cx="12" cy="12" r="4" />
    </svg>
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
            class="hover:text-primary truncate text-left hover:underline"
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
          <span class="truncate">{node.name}</span>
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
