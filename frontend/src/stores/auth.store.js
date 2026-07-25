/**
 * Auth store (zustand) — the single source of truth for "who is logged in"
 * on the client.
 *
 * Why zustand and not React context/useState? Any component (or plain JS —
 * the axios interceptor!) can read/write it without prop-drilling or being
 * inside a provider. `useAuthStore.getState()` works outside React entirely.
 *
 * SECURITY: the access token lives HERE, in memory, on purpose. Never in
 * localStorage (any XSS can read localStorage; it can't read a closure
 * variable it doesn't know about). Losing it on refresh is fine — the
 * httpOnly refresh cookie silently restores the session (see lib/api.js).
 */
import { create } from "zustand";

export const useAuthStore = create((set) => ({
  user: null, // { id, name, email, avatarUrl, role, emailVerified }
  accessToken: null, // short-lived JWT, memory only
  status: "loading", // "loading" (bootstrapping) | "authed" | "guest"

  setAuth: ({ user, accessToken }) =>
    set({ user, accessToken, status: "authed" }),

  setAccessToken: (accessToken) => set({ accessToken }),

  setUser: (user) => set({ user }),

  clearAuth: () => set({ user: null, accessToken: null, status: "guest" }),
}));
