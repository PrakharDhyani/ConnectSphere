/**
 * Gate for private pages. Three states:
 *  - bootstrapping → show a spinner (deciding too early would flash the
 *    login page at users who ARE logged in — the classic SPA auth bug)
 *  - guest → bounce to /login
 *  - authed → render the protected content
 */
import { Navigate } from "react-router-dom";
import { useAuthStore } from "@/stores/auth.store.js";

export default function ProtectedRoute({ children }) {
  const status = useAuthStore((s) => s.status);

  if (status === "loading") {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (status !== "authed") return <Navigate to="/login" replace />;

  return children;
}
