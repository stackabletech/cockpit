<script lang="ts">
  import type { TreemapNode } from '$lib/storage/details-types.js';
  import { formatFileSize } from '$lib/storage/utils.js';
  import IconContentCopy from 'virtual:icons/material-symbols/content-copy';
  import IconFolderOpen from 'virtual:icons/material-symbols/folder-open';

  interface Props {
    data: TreemapNode;
  }

  let { data }: Props = $props();

  const PAD = 3;
  const W = 600;
  const H = 400;

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

  const containerStrokes = [
    'stroke-primary/30',
    'stroke-secondary/30',
    'stroke-accent/30',
    'stroke-info/30',
    'stroke-success/30',
    'stroke-warning/30',
    'stroke-error/30'
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

  const rects = $derived.by(() => {
    const result: LayoutRect[] = [];
    layoutNode(data, 0, 0, W, H, 0, result);
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

  function strokeClass(depth: number, isContainer: boolean): string {
    if (!isContainer) return 'stroke-base-300/25 stroke-1';
    return containerStrokes[depth % containerStrokes.length] + ' stroke-1';
  }

  let menuEl = $state<HTMLDivElement | null>(null);
  let menuX = $state(0);
  let menuY = $state(0);
  let menuTarget = $state<LayoutRect | null>(null);

  function openContextMenu(e: MouseEvent, rect: LayoutRect) {
    e.preventDefault();
    e.stopPropagation();
    menuX = e.clientX;
    menuY = e.clientY;
    menuTarget = rect;
  }

  // Teleport menu to dialog to escape modal-box containing block and overflow clipping
  $effect(() => {
    const el = menuEl;
    if (el) {
      const dialog = el.closest('dialog');
      if (dialog && el.parentElement !== dialog) {
        dialog.appendChild(el);
      }
      return () => {
        el.remove();
      };
    }
  });

  function closeContextMenu() {
    menuTarget = null;
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

<div class="w-full overflow-x-auto">
  <svg
    viewBox="0 0 {W} {H}"
    class="w-full max-w-[600px]"
    role="img"
    aria-label="Treemap visualization of directory size composition"
  >
    <defs>
      {#each rects as rect (rect.x + '-' + rect.y + '-' + rect.w + '-' + rect.h)}
        {#if !rect.isContainer && rect.w > 40 && rect.h > 20}
          <linearGradient id="fg-{rect.x}-{rect.y}" x1="0" y1="0" x2="1" y2="0">
            <stop offset="60%" stop-color="#fff" />
            <stop offset="100%" stop-color="#fff" stop-opacity="0" />
          </linearGradient>
          <mask id="fm-{rect.x}-{rect.y}">
            <rect
              x={rect.x + 4}
              y={rect.y + 10}
              width={Math.max(rect.w - 8, 1)}
              height={Math.max(rect.h - 14, 1)}
              fill="url(#fg-{rect.x}-{rect.y})"
            />
          </mask>
        {/if}
      {/each}
    </defs>
    {#each rects as rect (rect.x + '-' + rect.y + '-' + rect.w + '-' + rect.h)}
      <g class="group cursor-pointer" oncontextmenu={(e) => openContextMenu(e, rect)}>
        <rect
          x={rect.x}
          y={rect.y}
          width={rect.w}
          height={rect.h}
          class="{fillClass(rect.depth, rect.isContainer)} {strokeClass(
            rect.depth,
            rect.isContainer
          )} transition-opacity hover:opacity-80"
          rx={rect.isContainer ? 1 : 2}
        />
        {#if !rect.isContainer && rect.w > 40}
          {#if rect.h > 34}
            <g mask="url(#fm-{rect.x}-{rect.y})">
              <text
                x={rect.x + 4}
                y={rect.y + 12}
                class="fill-base-content text-[11px] font-medium"
                dominant-baseline="hanging">{rect.name}</text
              >
              <text
                x={rect.x + 4}
                y={rect.y + 24}
                class="fill-base-content/45 text-[9px]"
                dominant-baseline="hanging">{rect.path || './'}</text
              >
              <text
                x={rect.x + 4}
                y={rect.y + 36}
                class="fill-base-content/70 text-[10px]"
                dominant-baseline="hanging">{formatFileSize(rect.size)}</text
              >
            </g>
          {:else if rect.h > 20}
            <g mask="url(#fm-{rect.x}-{rect.y})">
              <text
                x={rect.x + 4}
                y={rect.y + 14}
                class="fill-base-content text-[11px] font-medium"
                dominant-baseline="hanging">{rect.name}</text
              >
              <text
                x={rect.x + 4}
                y={rect.y + 28}
                class="fill-base-content/70 text-[10px]"
                dominant-baseline="hanging">{formatFileSize(rect.size)}</text
              >
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

<!-- backdrop: rendered in-place inside the modal (just needs to cover modal-box) -->
{#if menuTarget}
  <div
    class="fixed inset-0 z-40"
    onclick={closeContextMenu}
    oncontextmenu={(e) => {
      e.preventDefault();
      closeContextMenu();
    }}
  ></div>
{/if}

<!-- menu: teleported into dialog to escape modal-box containing block and overflow clipping -->
<div
  bind:this={menuEl}
  class="border-base-300 bg-base-100 fixed z-[1000] w-56 rounded-lg border p-1 shadow-lg"
  style="left: {menuX}px; top: {menuY}px; display: {menuTarget ? 'block' : 'none'}"
  oncontextmenu={(e) => {
    e.preventDefault();
    e.stopPropagation();
  }}
>
  {#if menuTarget}
    <button
      class="btn btn-ghost btn-sm w-full justify-start gap-2"
      onclick={() => {
        const t = menuTarget;
        if (t) copy(t.name);
      }}
    >
      <IconContentCopy class="size-4 shrink-0" aria-hidden="true" />
      {#if menuTarget.isContainer}
        Copy directory name
      {:else}
        Copy file name
      {/if}
    </button>
    {#if menuTarget.fullKey}
      <button
        class="btn btn-ghost btn-sm w-full justify-start gap-2"
        onclick={() => {
          const t = menuTarget;
          if (t?.fullKey) copy(t.fullKey);
        }}
      >
        <IconFolderOpen class="size-4 shrink-0" aria-hidden="true" />
        Copy full path
      </button>
    {/if}
  {/if}
</div>
