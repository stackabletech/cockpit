<script lang="ts">
  import type { Component } from 'svelte';
  import IconInfo from 'virtual:icons/material-symbols/info';
  import IconCheckCircle from 'virtual:icons/material-symbols/check-circle';
  import IconWarning from 'virtual:icons/material-symbols/warning';
  import IconError from 'virtual:icons/material-symbols/error';
  import IconClose from 'virtual:icons/material-symbols/close';
  import { toasts, removeToast, type ToastType } from '$lib/stores/toast.svelte.js';

  const iconMap: Record<ToastType, Component> = {
    info: IconInfo,
    success: IconCheckCircle,
    warning: IconWarning,
    error: IconError
  };

  const alertClassMap: Record<ToastType, string> = {
    info: 'alert-info',
    success: 'alert-success',
    warning: 'alert-warning',
    error: 'alert-error'
  };
</script>

<!-- Positioned fixed at the bottom-end corner, above everything -->
<div class="toast toast-end toast-bottom z-100 gap-2" aria-live="polite" aria-atomic="false">
  {#each toasts as toast (toast.id)}
    {@const ToastIcon = iconMap[toast.type]}
    <div
      role="alert"
      class="alert {alertClassMap[toast.type]} flex max-w-sm flex-col items-start gap-2 shadow-lg"
    >
      <div class="flex w-full items-start gap-2">
        <ToastIcon class="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        <span class="flex-1 text-sm">{toast.message}</span>
        <button
          class="btn btn-ghost btn-xs ml-1 shrink-0"
          aria-label="Dismiss"
          onclick={() => removeToast(toast.id)}
        >
          <IconClose class="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      {#if toast.actions && toast.actions.length > 0}
        <div class="flex w-full justify-end gap-2">
          {#each toast.actions as action, i (i)}
            <button
              class="btn btn-sm btn-neutral"
              onclick={() => {
                action.onClick();
                removeToast(toast.id);
              }}
            >
              {action.label}
            </button>
          {/each}
        </div>
      {/if}
    </div>
  {/each}
</div>
