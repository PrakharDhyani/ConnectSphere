import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "@/lib/api.js";
import { useAuthStore } from "@/stores/auth.store.js";
import Button from "@/components/ui/Button.jsx";

export default function DashboardPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const [resent, setResent] = useState(false);

  async function handleLogout() {
    await api.post("/auth/logout").catch(() => {}); // logout is idempotent
    clearAuth();
    navigate("/");
  }

  async function handleResend() {
    await api.post("/auth/resend-verification", { email: user.email }).catch(() => {});
    setResent(true);
  }

  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
        <span className="text-xl font-bold text-brand-400">🌐 ConnectSphere</span>
        <div className="flex items-center gap-4">
          <Link to="/profile" className="flex items-center gap-2 text-sm text-gray-400 hover:text-brand-400">
            {user?.avatarUrl ? (
              <img src={user.avatarUrl} alt="" className="w-7 h-7 rounded-full object-cover" />
            ) : (
              <span className="w-7 h-7 rounded-full bg-brand-900 flex items-center justify-center
                text-xs font-bold text-brand-200">
                {user?.name?.[0]?.toUpperCase() ?? "?"}
              </span>
            )}
            {user?.name}
          </Link>
          <Button variant="secondary" onClick={handleLogout}>Log out</Button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-10 space-y-6">
        {!user?.emailVerified && (
          <div className="flex items-center justify-between gap-4 bg-yellow-950/40 border border-yellow-900 rounded-lg p-4">
            <p className="text-sm text-yellow-300">
              Your email isn&apos;t verified yet — check your inbox for the link.
            </p>
            {resent ? (
              <span className="text-sm text-green-400 shrink-0">Sent ✓</span>
            ) : (
              <Button variant="secondary" onClick={handleResend} className="shrink-0">
                Resend email
              </Button>
            )}
          </div>
        )}

        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
          <h1 className="text-2xl font-bold">Welcome, {user?.name} 👋</h1>
          <p className="text-gray-400 mt-1 text-sm">{user?.email}</p>
          <p className="text-gray-500 mt-4 text-sm">
            Rooms and video calls are coming next — this dashboard is their home.
          </p>
        </div>
      </main>
    </div>
  );
}
