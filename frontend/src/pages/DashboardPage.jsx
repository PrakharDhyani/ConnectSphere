import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api.js";
import { disconnectSocket } from "@/lib/socket.js";
import { useAuthStore } from "@/stores/auth.store.js";
import Button from "@/components/ui/Button.jsx";
import Input from "@/components/ui/Input.jsx";

export default function DashboardPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const [resent, setResent] = useState(false);
  const [roomName, setRoomName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [formError, setFormError] = useState(null);

  // Server state → react-query: caching, loading/error states, refetching.
  const { data: rooms = [], isLoading } = useQuery({
    queryKey: ["rooms"],
    queryFn: async () => (await api.get("/rooms")).data.data.rooms,
  });

  // After a successful mutation, invalidate ["rooms"] — react-query refetches
  // the list automatically; no manual state juggling.
  const createRoom = useMutation({
    mutationFn: async (name) => (await api.post("/rooms", { name })).data.data.room,
    onSuccess: (room) => {
      queryClient.invalidateQueries({ queryKey: ["rooms"] });
      setRoomName("");
      navigate(`/room/${room.id}`);
    },
    onError: (err) => setFormError(err.response?.data?.error?.message || "Could not create room."),
  });

  const joinRoom = useMutation({
    mutationFn: async (code) => (await api.post("/rooms/join", { code })).data.data.room,
    onSuccess: (room) => {
      queryClient.invalidateQueries({ queryKey: ["rooms"] });
      setJoinCode("");
      navigate(`/room/${room.id}`);
    },
    onError: (err) =>
      setFormError(
        err.response?.status === 404
          ? "No room with that code."
          : err.response?.data?.error?.message || "Could not join room."
      ),
  });

  async function handleLogout() {
    await api.post("/auth/logout").catch(() => {});
    disconnectSocket(); // drop the realtime connection on logout
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

        {/* Create / Join */}
        <div className="grid sm:grid-cols-2 gap-4">
          <form
            className="bg-gray-900 border border-gray-800 rounded-2xl p-5 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              setFormError(null);
              if (roomName.trim().length >= 2) createRoom.mutate(roomName.trim());
            }}
          >
            <h2 className="font-semibold">Create a room</h2>
            <Input label="Room name" value={roomName} placeholder="Daily standup"
              onChange={(e) => setRoomName(e.target.value)} />
            <Button type="submit" loading={createRoom.isPending} className="w-full">Create</Button>
          </form>

          <form
            className="bg-gray-900 border border-gray-800 rounded-2xl p-5 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              setFormError(null);
              if (joinCode.trim()) joinRoom.mutate(joinCode.trim().toLowerCase());
            }}
          >
            <h2 className="font-semibold">Join with a code</h2>
            <Input label="Invite code" value={joinCode} placeholder="a1b2c3"
              onChange={(e) => setJoinCode(e.target.value)} />
            <Button type="submit" variant="secondary" loading={joinRoom.isPending} className="w-full">
              Join
            </Button>
          </form>
        </div>

        {formError && <p className="text-sm text-red-400">{formError}</p>}

        {/* Room list */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
          <h2 className="font-semibold mb-4">Your rooms</h2>
          {isLoading ? (
            <p className="text-gray-500 text-sm">Loading…</p>
          ) : rooms.length === 0 ? (
            <p className="text-gray-500 text-sm">
              No rooms yet — create one above, or join with a friend&apos;s code.
            </p>
          ) : (
            <ul className="divide-y divide-gray-800">
              {rooms.map((room) => (
                <li key={room.id}>
                  <Link to={`/room/${room.id}`}
                    className="flex items-center justify-between py-3 px-2 rounded-lg hover:bg-gray-800/60 transition-colors">
                    <div>
                      <p className="font-medium">{room.name}</p>
                      <p className="text-xs text-gray-500">
                        code <span className="font-mono text-gray-400">{room.code}</span>
                        {" · "}{room.memberCount} member{room.memberCount === 1 ? "" : "s"}
                      </p>
                    </div>
                    <span className="text-brand-400 text-sm">Open →</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>
    </div>
  );
}
