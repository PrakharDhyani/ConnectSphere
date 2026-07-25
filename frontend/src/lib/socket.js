/**
 * Socket.io client singleton.
 *
 * Connects to the same origin (:3000) — Vite's dev proxy forwards /socket.io to
 * the backend (:5000) with `ws: true`, so no CORS and no hardcoded URL. The
 * access token is provided via the `auth` callback so every (re)connect uses
 * the CURRENT token from the store, not a stale one captured at import time.
 */
import { io } from "socket.io-client";
import { useAuthStore } from "@/stores/auth.store.js";

let socket;

export function getSocket() {
  if (!socket) {
    socket = io({
      autoConnect: false,
      auth: (cb) => cb({ token: useAuthStore.getState().accessToken }),
    });
  }
  return socket;
}

export function connectSocket() {
  const s = getSocket();
  if (!s.connected) s.connect();
  return s;
}

export function disconnectSocket() {
  if (socket?.connected) socket.disconnect();
}
