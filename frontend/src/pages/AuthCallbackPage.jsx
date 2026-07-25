/**
 * Landing spot after Google OAuth. The backend already did all the work
 * (verified with Google, found/created the user, set the httpOnly refresh
 * cookie) and then redirected the browser here. We just have to exchange
 * that cookie for an access token — which is exactly what bootstrapAuth does.
 */
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { bootstrapAuth } from "@/lib/api.js";
import { useAuthStore } from "@/stores/auth.store.js";

export default function AuthCallbackPage() {
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      await bootstrapAuth();
      const { status } = useAuthStore.getState();
      navigate(status === "authed" ? "/dashboard" : "/login?error=oauth", { replace: true });
    })();
  }, [navigate]);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-3">
      <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
      <p className="text-gray-400">Finishing sign-in…</p>
    </div>
  );
}
