<script lang="ts">
  import type { TreemapNode } from '$lib/storage/details-types.js';
  import { formatFileSize } from '$lib/storage/utils.js';

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
    'stroke-primary/25',
    'stroke-secondary/25',
    'stroke-accent/25',
    'stroke-info/25',
    'stroke-success/25',
    'stroke-warning/25',
    'stroke-error/25'
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
    const isContainer = !!(node.children && node.children.length > 0);
    rects.push({
      x,
      y,
      w,
      h,
      name: node.name,
      size: node.size,
      depth,
      isContainer,
      path: node.path
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

    for (const child of node.children!) {
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
    if (!isContainer) return '';
    return containerStrokes[depth % containerStrokes.length];
  }
</script>

<div class="w-full overflow-x-auto">
  <svg
    viewBox="0 0 {W} {H}"
    class="w-full max-w-[600px]"
    role="img"
    aria-label="Treemap visualization of directory size composition"
  >
    {#each rects as rect (rect.x + '-' + rect.y + '-' + rect.w + '-' + rect.h)}
      <g class="group">
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
            <text
              x={rect.x + 4}
              y={rect.y + 12}
              class="fill-base-content text-[11px] font-medium"
              dominant-baseline="hanging"
            >
              {rect.name.length > 22 ? rect.name.slice(0, 20) + '...' : rect.name}
            </text>
            <text
              x={rect.x + 4}
              y={rect.y + 24}
              class="fill-base-content/45 text-[9px]"
              dominant-baseline="hanging"
            >
              {#if rect.path}
                {rect.path.length > 28 ? rect.path.slice(0, 26) + '...' : rect.path}
              {:else}
                ./
              {/if}
            </text>
            <text
              x={rect.x + 4}
              y={rect.y + 36}
              class="fill-base-content/70 text-[10px]"
              dominant-baseline="hanging"
            >
              {formatFileSize(rect.size)}
            </text>
          {:else if rect.h > 20}
            <text
              x={rect.x + 4}
              y={rect.y + 14}
              class="fill-base-content text-[11px] font-medium"
              dominant-baseline="hanging"
            >
              {rect.name.length > 20 ? rect.name.slice(0, 18) + '...' : rect.name}
            </text>
            <text
              x={rect.x + 4}
              y={rect.y + 28}
              class="fill-base-content/70 text-[10px]"
              dominant-baseline="hanging"
            >
              {formatFileSize(rect.size)}
            </text>
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
