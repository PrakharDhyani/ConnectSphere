/**
 * API layer — one axios instance every feature uses.
 *
 * Does three jobs:
 *  1. Request interceptor: attach `Authorization: Bearer <access token>`
 *     from the auth store to every request, automatically.
 *  2. Response interceptor: if a request comes back 401 (access token
 *     expired — they only live 15 minutes), silently call /auth/refresh
 *     once (the browser attaches the httpOnly cookie itself), store the new
 *     token, and RETRY the original request. The user never notices.
 *  3. bootstrapAuth(): run once at app start — a page reload wipes the
 *     in-memory token, so we ask /refresh whether the cookie session is
 *     still alive and restore the user if so.
 */
import axios from "axios";
import { useAuthStore } from "@/stores/auth.store.js";

// baseURL "/api" is relative — in dev the Vite proxy forwards it to :5000.
export const api = axios.create({ baseURL: "/api", withCredentials: true });

// ── (1) attach the access token ──
api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Single-flight refresh: if five requests all 401 at once, only ONE refresh
// call goes out; the rest await the same promise. (Critical: refresh tokens
// are single-use — two parallel refreshes would invalidate each other.)
let refreshPromise = null;

export function refreshAccessToken() {
  if (!refreshPromise) {
    // Raw axios, not `api` — must not recurse through these interceptors.
    refreshPromise = axios
      .post("/api/auth/refresh", null, { withCredentials: true })
      .then((res) => res.data.data.accessToken)
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

// ── (2) silent refresh-and-retry on 401 ──
api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    const isAuthRoute = original?.url?.includes("/auth/");

    // Retry only: real 401s, on non-auth endpoints, and only once per request
    // (a login 401 means wrong password — refreshing won't fix that).
    if (error.response?.status === 401 && !original._retry && !isAuthRoute) {
      original._retry = true;
      try {
        const token = await refreshAccessToken();
        useAuthStore.getState().setAccessToken(token);
        original.headers.Authorization = `Bearer ${token}`;
        return api(original);
      } catch {
        // Refresh failed too → session is truly over.
        useAuthStore.getState().clearAuth();
      }
    }
    return Promise.reject(error);
  }
);

// ── (3) session restore on app boot ──
export async function bootstrapAuth() {
  const store = useAuthStore.getState();
  try {
    const accessToken = await refreshAccessToken();
    store.setAccessToken(accessToken);
    const me = await api.get("/users/me");
    store.setAuth({ user: me.data.data.user, accessToken });
  } catch {
    store.clearAuth(); // no valid cookie → guest; not an error
  }
}
