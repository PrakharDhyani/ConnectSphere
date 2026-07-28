/**
 * Gate for auth-only pages (login / register). The inverse of ProtectedRoute:
 *  - bootstrapping → spinner (deciding too early flashes the login form at
 *    users who ARE already logged in, then yanks it away — the classic bug)
 *  - logged-in full user → bounce to /dashboard (which offers logout /
 *    profile / switch-account); they have no reason to see a login form
 *  - guest visitor → let through, so they can upgrade to a real account
 *  - otherwise → render
 */
import { Navigate } from "react-router-dom";
import { useAuthStore } from "@/stores/auth.store.js";

export default function PublicOnlyRoute({ children }) {
  const status = useAuthStore((s) => s.status);
  const isGuest = useAuthStore((s) => s.user?.isGuest);

  if (status === "loading") {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (status === "authed" && !isGuest) return <Navigate to="/dashboard" replace />;

  return children;
}
