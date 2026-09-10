<script lang="ts">
  import type { TreemapNode } from '$lib/storage/details-types.js';
  import { formatFileSize } from '$lib/storage/utils.js';
  import * as m from '$lib/paraglide/messages.js';
  import IconContentCopy from 'virtual:icons/material-symbols/content-copy';
  import IconFolderOpen from 'virtual:icons/material-symbols/folder-open';
  import FloatingMenu from '$lib/components/storage/shared/FloatingMenu.svelte';

  interface Props {
    data: TreemapNode;
    fullWidth?: boolean;
  }

  let { data, fullWidth = false }: Props = $props();

  // 1px margin on every side of each rect creates visible gaps between neighbours
  const MARGIN = 1;
  // Padding from a container edge inward to where its children start
  const PAD = 4;
  // H is fixed; W is measured from the container so the layout recalculates
  // for the actual rendered width rather than just scaling the SVG.
  const H = 400;

  let containerEl = $state<HTMLDivElement | null>(null);
  let containerWidth = $state(0);

  // In fullWidth mode, recalculate the layout for the real container width.
  // In normal mode the SVG is constrained to max-w-150 (600 px) so W=600.
  const W = $derived(fullWidth && containerWidth > 4 ? containerWidth : 600);

  $effect(() => {
    if (!containerEl || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      containerWidth = Math.round(entries[0].contentRect.width);
    });
    ro.observe(containerEl);
    return () => ro.disconnect();
  });

  // Maximum number of file (leaf) nodes to render; the smallest ones are
  // grouped per their immediate parent directory into a single “N more” node.
  const MAX_VISIBLE_LEAVES = 30;

  const containerFills = [
    'fill-primary/8',
    'fill-secondary/8',
    'fill-accent/8',
    'fill-info/8',
    'fill-success/8',
    'fill-warning/8',
    'fill-error/8'
  ];

  const leafFills = [
    'fill-primary/35',
    'fill-secondary/35',
    'fill-accent/35',
    'fill-info/35',
    'fill-success/35',
    'fill-warning/35',
    'fill-error/35'
  ];

  interface LayoutRect {
    x: number;
    y: number;
    w: number;
    h: number;
    name: string;
    size: number;
    depth: number;
    isContainer: boolean;
    path: string | undefined;
    fullKey: string | undefined;
  }

  /**
   * Prune leaf nodes to at most MAX_VISIBLE_LEAVES.
   * Smallest leaves are grouped per their immediate parent into a single
   * synthetic “N more” node so the treemap stays hierarchically accurate.
   */
  function pruneTree(root: TreemapNode, moreLabel: (count: number) => string): TreemapNode {
    function countLeaves(node: TreemapNode): number {
      if (!node.children || node.children.length === 0) return 1;
      return node.children.reduce((sum, child) => sum + countLeaves(child), 0);
    }

    if (countLeaves(root) <= MAX_VISIBLE_LEAVES) return root;

    const allLeaves: TreemapNode[] = [];
    function collectLeaves(node: TreemapNode) {
      if (!node.children || node.children.length === 0) {
        allLeaves.push(node);
      } else {
        for (const child of node.children) collectLeaves(child);
      }
    }
    collectLeaves(root);

    const sorted = [...allLeaves].sort((a, b) => b.size - a.size);
    const kept = new Set<TreemapNode>(sorted.slice(0, MAX_VISIBLE_LEAVES));

    function rebuild(node: TreemapNode): TreemapNode {
      if (!node.children || node.children.length === 0) return node;

      const newChildren: TreemapNode[] = [];
      let overflowSize = 0;
      let overflowCount = 0;

      for (const child of node.children) {
        if (!child.children || child.children.length === 0) {
          if (kept.has(child)) {
            newChildren.push(child);
          } else {
            overflowSize += child.size;
            overflowCount++;
          }
        } else {
          const rebuilt = rebuild(child);
          if (rebuilt.children && rebuilt.children.length > 0) newChildren.push(rebuilt);
        }
      }

      if (overflowCount > 0) {
        newChildren.push({ name: moreLabel(overflowCount), size: overflowSize });
      }

      return { ...node, children: newChildren.sort((a, b) => b.size - a.size) };
    }

    return rebuild(root);
  }

  const prunedData = $derived(
    pruneTree(data, (count) => m.storage_details_treemap_more({ count }))
  );

  const rects = $derived.by(() => {
    const result: LayoutRect[] = [];
    layoutNode(prunedData, 0, 0, W, H, 0, result);
    return result;
  });

  function layoutNode(
    node: TreemapNode,
    x: number,
    y: number,
    w: number,
    h: number,
    depth: number,
    rects: LayoutRect[]
  ) {
    const children = node.children;
    const isContainer = !!(children && children.length > 0);

    // Collapse single-child containers to avoid padding exhaustion from deep nesting
    if (isContainer && children!.length === 1) {
      layoutNode(children![0], x, y, w, h, depth + 1, rects);
      return;
    }

    rects.push({
      x,
      y,
      w,
      h,
      name: node.name,
      size: node.size,
      depth,
      isContainer,
      path: node.path,
      fullKey: node.fullKey
    });

    if (!isContainer) return;

    const ix = x + PAD;
    const iy = y + PAD;
    const iw = Math.max(0, w - 2 * PAD);
    const ih = Math.max(0, h - 2 * PAD);
    if (iw <= 0 || ih <= 0) return;

    const total = node.size || 1;
    let cx = ix;
    let cy = iy;
    let remW = iw;
    let remH = ih;
    let horizontal = remW >= remH;

    for (const child of children!) {
      const area = (child.size / total) * iw * ih;
      let cw: number;
      let ch: number;
      if (horizontal) {
        ch = remH;
        cw = remW > 0 ? Math.max(1, area / ch) : 1;
      } else {
        cw = remW;
        ch = remH > 0 ? Math.max(1, area / cw) : 1;
      }
      cw = Math.min(cw, remW);
      ch = Math.min(ch, remH);

      layoutNode(child, cx, cy, cw, ch, depth + 1, rects);

      if (horizontal) {
        cx += cw;
        remW -= cw;
      } else {
        cy += ch;
        remH -= ch;
      }
      if (remW <= 0 || remH <= 0) break;
      horizontal = remW >= remH;
    }
  }

  function fillClass(depth: number, isContainer: boolean): string {
    const idx = depth % containerFills.length;
    return isContainer ? containerFills[idx] : leafFills[idx];
  }

  let ctxMenu = $state<{ x: number; y: number; target: LayoutRect } | null>(null);

  function openContextMenu(e: MouseEvent | KeyboardEvent, rect: LayoutRect) {
    e.preventDefault();
    e.stopPropagation();
    if (e instanceof MouseEvent) {
      ctxMenu = { x: e.clientX, y: e.clientY, target: rect };
    } else {
      const el = e.currentTarget as SVGGElement;
      const r = el.getBoundingClientRect();
      ctxMenu = { x: r.right, y: r.top, target: rect };
    }
  }

  function closeContextMenu() {
    ctxMenu = null;
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    closeContextMenu();
  }
</script>

<div class="w-full overflow-x-auto" bind:this={containerEl}>
  <svg
    viewBox="0 0 {W} {H}"
    class="bg-base-200 w-full {fullWidth ? '' : 'max-w-150'} rounded"
    role="img"
    aria-label={m.storage_details_treemap_aria()}
  >
    <defs>
      {#each rects as rect (rect.x + '-' + rect.y + '-' + rect.w + '-' + rect.h)}
        {#if !rect.isContainer && rect.w > 40 && rect.h > 14}
          <linearGradient id="fg-{rect.x}-{rect.y}" x1="0" y1="0" x2="1" y2="0">
            <stop offset="60%" stop-color="#fff" />
            <stop offset="100%" stop-color="#fff" stop-opacity="0" />
          </linearGradient>
          <mask id="fm-{rect.x}-{rect.y}">
            <!-- Full inner-rect height so the gradient only fades horizontally,
                 never clips text vertically. -->
            <rect
              x={rect.x + MARGIN + 4}
              y={rect.y + MARGIN}
              width={Math.max(rect.w - 2 * MARGIN - 8, 1)}
              height={Math.max(rect.h - 2 * MARGIN, 1)}
              fill="url(#fg-{rect.x}-{rect.y})"
            />
          </mask>
        {/if}
      {/each}
    </defs>
    {#each rects as rect (rect.x + '-' + rect.y + '-' + rect.w + '-' + rect.h)}
      <g
        class="group cursor-pointer"
        role="treeitem"
        tabindex="0"
        aria-selected="false"
        oncontextmenu={(e) => openContextMenu(e, rect)}
        onkeydown={(e) => {
          if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) openContextMenu(e, rect);
        }}
      >
        <!-- 1px margin on every side creates visible gaps between adjacent rects -->
        <rect
          x={rect.x + MARGIN}
          y={rect.y + MARGIN}
          width={Math.max(rect.w - 2 * MARGIN, 1)}
          height={Math.max(rect.h - 2 * MARGIN, 1)}
          class="{fillClass(rect.depth, rect.isContainer)} transition-opacity hover:opacity-80"
          rx={rect.isContainer ? 1 : 2}
        />
        {#if !rect.isContainer && rect.w > 40}
          {@const ih = rect.h - 2 * MARGIN}
          {#if ih >= 15}
            <!--
              Text layout (TOP_PAD = 3, line height ≈ 13):
                name  (11px) at y+MARGIN+3  → bottom ≈ y+MARGIN+14
                path   (9px) at y+MARGIN+16 → bottom ≈ y+MARGIN+25  (only if ih≥38)
                size  (10px) at y+MARGIN+27 → bottom ≈ y+MARGIN+37  (3-line)
                  or   at y+MARGIN+16 → bottom ≈ y+MARGIN+26        (2-line, ih≥27)
            -->
            <g mask="url(#fm-{rect.x}-{rect.y})">
              <text
                x={rect.x + MARGIN + 4}
                y={rect.y + MARGIN + 3}
                class="fill-base-content text-[11px] font-medium"
                dominant-baseline="hanging">{rect.name}</text
              >
              {#if ih >= 38}
                <text
                  x={rect.x + MARGIN + 4}
                  y={rect.y + MARGIN + 16}
                  class="fill-base-content/45 text-[9px]"
                  dominant-baseline="hanging">{rect.path || './'}</text
                >
                <text
                  x={rect.x + MARGIN + 4}
                  y={rect.y + MARGIN + 27}
                  class="fill-base-content/70 text-[10px]"
                  dominant-baseline="hanging">{formatFileSize(rect.size)}</text
                >
              {:else if ih >= 27}
                <text
                  x={rect.x + MARGIN + 4}
                  y={rect.y + MARGIN + 16}
                  class="fill-base-content/70 text-[10px]"
                  dominant-baseline="hanging">{formatFileSize(rect.size)}</text
                >
              {/if}
            </g>
          {/if}
        {/if}
        <title>
          {rect.name}{#if rect.path}
            ({rect.path}){/if}: {formatFileSize(rect.size)}
        </title>
      </g>
    {/each}
  </svg>
</div>

<FloatingMenu
  x={ctxMenu?.x ?? 0}
  y={ctxMenu?.y ?? 0}
  open={ctxMenu !== null}
  onclose={closeContextMenu}
>
  {#if ctxMenu}
    <button
      role="menuitem"
      class="btn btn-ghost btn-sm w-full justify-start gap-2"
      onclick={() => {
        const t = ctxMenu!.target;
        copy(t.name);
      }}
    >
      <IconContentCopy class="size-4 shrink-0" aria-hidden="true" />
      {#if ctxMenu.target.isContainer}
        {m.storage_details_copy_dir_name()}
      {:else}
        {m.storage_details_copy_file_name()}
      {/if}
    </button>
    {#if ctxMenu.target.fullKey}
      <button
        role="menuitem"
        class="btn btn-ghost btn-sm w-full justify-start gap-2"
        onclick={() => {
          const t = ctxMenu!.target;
          if (t.fullKey) copy(t.fullKey);
        }}
      >
        <IconFolderOpen class="size-4 shrink-0" aria-hidden="true" />
        {m.storage_details_copy_full_path()}
      </button>
    {/if}
  {/if}
</FloatingMenu>
