import { create } from 'zustand';

export type ToastTone = 'error' | 'info';
export type Toast = { id: number; tone: ToastTone; message: string };

/** Errors wait long enough to be read after a glance away; notices do not. */
export const TOAST_DURATION_MS: Record<ToastTone, number> = { error: 8000, info: 4000 };
/** Older notices give way rather than stacking up the window edge. */
const MAX_VISIBLE = 3;

type ToastState = {
  toasts: Toast[];
  dismiss: (id: number) => void;
};

let nextId = 1;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
}));

/**
 * Shows a transient, non-blocking notice. This replaces `window.alert`, which
 * froze the whole window behind an unbranded WebKit sheet for a failed rename.
 * The same message is not stacked twice while it is still showing.
 */
export function showToast(message: string, tone: ToastTone = 'info'): void {
  useToastStore.setState((state) => {
    if (state.toasts.some((toast) => toast.message === message && toast.tone === tone)) return state;
    const toast = { id: nextId++, tone, message };
    return { toasts: [...state.toasts, toast].slice(-MAX_VISIBLE) };
  });
}

export const showErrorToast = (message: string): void => showToast(message, 'error');

/** Test hygiene: the store is module-global. */
export function resetToasts(): void {
  useToastStore.setState({ toasts: [] });
}
