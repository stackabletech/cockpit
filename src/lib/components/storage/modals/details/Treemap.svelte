<script lang="ts">
  import type { TreemapNode } from '$lib/storage/details-types.js';
  import { formatFileSize } from '$lib/storage/utils.js';

  interface Props {
    data: TreemapNode;
  }

  let { data }: Props = $props();

  const colors = [
    'fill-primary/30',
    'fill-secondary/30',
    'fill-accent/30',
    'fill-info/30',
    'fill-success/30',
    'fill-warning/30',
    'fill-error/30',
    'fill-primary/20',
    'fill-secondary/20',
    'fill-accent/20'
  ];

  interface LayoutRect {
    x: number;
    y: number;
    w: number;
    h: number;
    name: string;
    size: number;
    color: string;
  }

  let layout = $derived.by(() => {
    if (!data.children || data.children.length === 0) return [];
    const total = data.size || 1;
    const W = 600;
    const H = 400;
    const rects: LayoutRect[] = [];
    let x = 0;
    let y = 0;
    let w = W;
    let h = H;
    let rowIsHorizontal = w >= h;

    const items: Array<TreemapNode & { color: string }> = data.children.map((c, i) => ({
      ...c,
      color: colors[i % colors.length]
    }));

    function layoutRow(rowItems: Array<TreemapNode & { color: string }>) {
      for (const item of rowItems) {
        const area = (item.size / total) * W * H;
        if (rowIsHorizontal) {
          const iw = area / h;
          rects.push({ x, y, w: iw, h, name: item.name, size: item.size, color: item.color });
          x += iw;
          w -= iw;
        } else {
          const ih = area / w;
          rects.push({ x, y: y, w, h: ih, name: item.name, size: item.size, color: item.color });
          y += ih;
          h -= ih;
        }
      }
    }

    layoutRow(items);
    return rects;
  });
</script>

<div class="w-full overflow-x-auto">
  <svg
    viewBox="0 0 600 400"
    class="w-full max-w-[600px]"
    role="img"
    aria-label="Treemap visualization of directory size composition"
  >
    {#each layout as rect}
      <g class="group">
        <rect
          x={rect.x}
          y={rect.y}
          width={rect.w}
          height={rect.h}
          class="{rect.color} stroke-base-100 stroke-1 transition-opacity hover:opacity-80"
          rx="2"
        />
        {#if rect.w > 40 && rect.h > 20}
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
        <title>
          {rect.name}: {formatFileSize(rect.size)}
        </title>
      </g>
    {/each}
  </svg>
</div>
