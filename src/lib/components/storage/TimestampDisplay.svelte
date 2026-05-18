<script lang="ts">
  import { getLocale } from '$lib/paraglide/runtime.js';
  import * as m from '$lib/paraglide/messages.js';

  type TooltipPosition = 'tooltip-top' | 'tooltip-bottom' | 'tooltip-left' | 'tooltip-right';

  interface Props {
    /** The date to display. Accepts a `Date` object or an ISO string. */
    date: Date | string;
    /**
     * When true, the label shows a relative time ("2h ago").
     * When false (default), the label shows a short formatted date ("13 May 2026").
     */
    relative?: boolean;
    /** DaisyUI tooltip direction. */
    tooltip?: TooltipPosition;
  }

  let { date, relative = false, tooltip = 'tooltip-top' }: Props = $props();

  const d = $derived(typeof date === 'string' ? new Date(date) : date);

  const fullTimestamp = $derived(
    d.toLocaleString(getLocale(), {
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
      if (mins < 1) return m.timestamp_just_now();
      if (mins < 60) return m.timestamp_minutes_ago({ count: mins });
      const hrs = Math.floor(mins / 60);
      if (hrs < 24) return m.timestamp_hours_ago({ count: hrs });
      const days = Math.floor(hrs / 24);
      return m.timestamp_days_ago({ count: days });
    }
    return new Intl.DateTimeFormat(getLocale(), {
      year: 'numeric',
      month: 'short',
      day: '2-digit'
    }).format(d);
  });
</script>

<span class="tooltip {tooltip}" data-tip={fullTimestamp}>{label}</span>
