/**
 * /join/:code — where an invite link lands.
 *
 * - Already signed in (registered): auto-join the room by code and go straight in.
 * - Not signed in: offer a one-field "join as guest" (display name only), or
 *   links to sign in / sign up.
 */
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "@/lib/api.js";
import { useAuthStore } from "@/stores/auth.store.js";
import AuthCard from "@/components/ui/AuthCard.jsx";
import Input from "@/components/ui/Input.jsx";
import Button from "@/components/ui/Button.jsx";

export default function JoinPage() {
  const { code } = useParams();
  const navigate = useNavigate();
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const setAuth = useAuthStore((s) => s.setAuth);

  const [name, setName] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  // Registered users joining a link → auto-join by code and enter the room.
  useEffect(() => {
    if (status !== "authed" || user?.isGuest) return;
    (async () => {
      try {
        const res = await api.post("/rooms/join", { code });
        navigate(`/room/${res.data.data.room.id}`, { replace: true });
      } catch (err) {
        setError(err.response?.status === 404 ? "No meeting found for that link." : "Could not join.");
      }
    })();
  }, [status, user, code, navigate]);

  async function joinAsGuest(e) {
    e.preventDefault();
    if (name.trim().length < 2) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.post("/auth/guest", { name: name.trim(), code });
      const { user: guest, accessToken, room } = res.data.data;
      setAuth({ user: guest, accessToken });
      navigate(`/room/${room.id}`, { replace: true });
    } catch (err) {
      setError(err.response?.status === 404 ? "No meeting found for that link." : "Could not join the meeting.");
    } finally {
      setBusy(false);
    }
  }

  // While a signed-in user is auto-joining, show a spinner.
  if (status === "loading" || (status === "authed" && !user?.isGuest && !error)) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-3">
        <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-gray-400">Joining the meeting…</p>
      </div>
    );
  }

  return (
    <AuthCard title="You're invited to a meeting" subtitle="Join the call with just your name — no account needed.">
      <form onSubmit={joinAsGuest} className="space-y-4">
        <Input
          label="Your name"
          value={name}
          placeholder="e.g. Alex"
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <Button type="submit" loading={busy} disabled={name.trim().length < 2} className="w-full">
          Join as guest
        </Button>
      </form>

      <div className="mt-6 text-sm text-gray-400 text-center">
        Have an account?{" "}
        <Link to="/login" className="text-brand-400 hover:underline">Log in</Link>{" "}
        ·{" "}
        <Link to="/register" className="text-brand-400 hover:underline">Sign up</Link>
      </div>
    </AuthCard>
  );
}
