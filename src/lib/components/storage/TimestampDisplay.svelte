<script lang="ts">
  interface Props {
    /** The date to display. Accepts a `Date` object or an ISO string. */
    date: Date | string;
    /**
     * When true, the label shows a relative time ("2h ago").
     * When false (default), the label shows a short formatted date ("13 May 2026").
     */
    relative?: boolean;
    /** DaisyUI tooltip direction class, e.g. "tooltip-top", "tooltip-left". */
    tooltipClass?: string;
  }

  let { date, relative = false, tooltipClass = 'tooltip-top' }: Props = $props();

  const d = $derived(typeof date === 'string' ? new Date(date) : date);

  const fullTimestamp = $derived(
    d.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  );

  const label = $derived.by(() => {
    if (relative) {
      const diff = Date.now() - d.getTime();
      const mins = Math.floor(diff / 60_000);
      if (mins < 1) return 'just now';
      if (mins < 60) return `${mins}m ago`;
      const hrs = Math.floor(mins / 60);
      if (hrs < 24) return `${hrs}h ago`;
      const days = Math.floor(hrs / 24);
      return `${days}d ago`;
    }
    return new Intl.DateTimeFormat('en-GB', {
      year: 'numeric',
      month: 'short',
      day: '2-digit'
    }).format(d);
  });
</script>

<span class="tooltip {tooltipClass}" data-tip={fullTimestamp}>{label}</span>
