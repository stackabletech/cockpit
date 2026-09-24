export type ToastType = 'info' | 'success' | 'warning' | 'error';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

interface Toast {
  id: string;
  type: ToastType;
  message: string;
  actions?: ToastAction[];
}

export const toasts = $state<Toast[]>([]);

export function addToast(
  type: ToastType,
  message: string,
  durationMs = 5000,
  actions?: ToastAction[]
): string {
  const id = crypto.randomUUID();
  toasts.push({ id, type, message, actions });
  if (durationMs > 0) {
    setTimeout(() => removeToast(id), durationMs);
  }
  return id;
}

export function removeToast(id: string): void {
  const idx = toasts.findIndex((t) => t.id === id);
  if (idx !== -1) toasts.splice(idx, 1);
}
