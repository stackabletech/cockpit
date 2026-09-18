<script lang="ts">
  const GAP = 6;

  interface Props {
    text: string;
    x: number;
    y: number;
    orientation?: 'right' | 'left' | 'up' | 'down';
  }
  let { text, x, y, orientation = 'right' }: Props = $props();

  // The critical behaviour (fixed positioning, no pointer interception, high
  // z-index) is applied inline so the tooltip behaves identically even when
  // utility classes are unavailable (e.g. in component tests that render
  // without the global stylesheet).
  const contentStyle = $derived(
    `position:fixed;pointer-events:none;z-index:150;${positionStyle(orientation, x, y)}`
  );

  function positionStyle(orientation: NonNullable<Props['orientation']>, x: number, y: number) {
    switch (orientation) {
      case 'right':
        return `left:${x + GAP}px;top:${y}px;transform:translateY(-50%)`;
      case 'left':
        return `left:${x - GAP}px;top:${y}px;transform:translate(-100%,-50%)`;
      case 'up':
        return `left:${x}px;top:${y - GAP}px;transform:translate(-50%,-100%)`;
      case 'down':
        return `left:${x}px;top:${y + GAP}px;transform:translate(-50%,0)`;
    }
  }

  const arrowClasses = $derived(
    orientation === 'right'
      ? 'left-0 top-1/2 -translate-x-1/2 -translate-y-1/2'
      : orientation === 'left'
        ? 'right-0 top-1/2 translate-x-1/2 -translate-y-1/2'
        : orientation === 'up'
          ? 'bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2'
          : 'top-0 left-1/2 -translate-x-1/2 -translate-y-1/2'
  );
</script>

<div role="tooltip" style={contentStyle}>
  <div
    class="bg-neutral text-neutral-content relative rounded-md px-2 py-1 text-sm whitespace-nowrap shadow-lg"
  >
    <div class="bg-neutral absolute size-2 rotate-45 {arrowClasses}" aria-hidden="true"></div>
    {text}
  </div>
</div>
