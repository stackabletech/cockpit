<script lang="ts">
  import Icon from '@iconify/svelte';
  import { toasts, removeToast, type ToastType } from '$lib/stores/toast.svelte.js';

  const iconMap: Record<ToastType, string> = {
    info: 'material-symbols:info',
    success: 'material-symbols:check-circle',
    warning: 'material-symbols:warning',
    error: 'material-symbols:error'
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
    <div
      role="alert"
      class="alert {alertClassMap[toast.type]} flex max-w-sm items-start gap-2 shadow-lg"
    >
      <Icon icon={iconMap[toast.type]} class="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
      <span class="flex-1 text-sm">{toast.message}</span>
      <button
        class="btn btn-ghost btn-xs ml-1 shrink-0"
        aria-label="Dismiss"
        onclick={() => removeToast(toast.id)}
      >
        <Icon icon="material-symbols:close" class="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  {/each}
</div>
