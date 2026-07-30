/**
 * Global toast notifications (friend requests/accepts, room invites). App-wide
 * so they show on any page, not just inside a room. `push` returns an id and
 * auto-dismisses after `duration`.
 */
import { create } from "zustand";

let seq = 0;

export const useNotify = create((set) => ({
  toasts: [],
  push: (toast) => {
    const id = ++seq;
    set((s) => ({ toasts: [...s.toasts.slice(-4), { id, ...toast }] }));
    setTimeout(
      () => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
      toast.duration || 7000
    );
    return id;
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
