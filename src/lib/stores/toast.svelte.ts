export type ToastType = 'info' | 'success' | 'warning' | 'error';

interface Toast {
  id: string;
  type: ToastType;
  message: string;
}

export const toasts = $state<Toast[]>([]);

export function addToast(type: ToastType, message: string, durationMs = 5000): void {
  const id = crypto.randomUUID();
  toasts.push({ id, type, message });
  if (durationMs > 0) {
    setTimeout(() => removeToast(id), durationMs);
  }
}

export function removeToast(id: string): void {
  const idx = toasts.findIndex((t) => t.id === id);
  if (idx !== -1) toasts.splice(idx, 1);
}
