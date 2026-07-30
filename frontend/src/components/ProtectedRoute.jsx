/**
 * Gate for private pages. States:
 *  - bootstrapping → spinner (deciding too early flashes the login page at
 *    users who ARE logged in — the classic SPA auth bug)
 *  - guest visitor → bounce to /login
 *  - `fullUserOnly` page + ephemeral guest → bounce home (guests can't use the
 *    dashboard/profile; they only belong inside their meeting)
 *  - otherwise → render
 */
import { Navigate } from "react-router-dom";
import { useAuthStore } from "@/stores/auth.store.js";

export default function ProtectedRoute({ children, fullUserOnly = false }) {
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);

  if (status === "loading") {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (status !== "authed") return <Navigate to="/login" replace />;
  if (fullUserOnly && user?.isGuest) return <Navigate to="/" replace />;

  return children;
}
