import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api.js";
import Button from "@/components/ui/Button.jsx";

export default function RoomPage() {
  const { roomId } = useParams();
  const [copied, setCopied] = useState(false);

  const { data: room, isLoading, error } = useQuery({
    queryKey: ["room", roomId],
    queryFn: async () => (await api.get(`/rooms/${roomId}`)).data.data.room,
    retry: false, // a 403/404 won't get better by retrying
  });

  async function copyCode() {
    await navigator.clipboard.writeText(room.code).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    const denied = error.response?.status === 403;
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <h1 className="text-2xl font-bold">{denied ? "Not a member" : "Room not found"}</h1>
        <p className="text-gray-400 text-sm">
          {denied
            ? "Ask the owner for the invite code and join from your dashboard."
            : "This room doesn't exist (or the link is wrong)."}
        </p>
        <Link to="/dashboard" className="text-brand-400 hover:underline text-sm">← Back to dashboard</Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
        <Link to="/dashboard" className="text-xl font-bold text-brand-400">🌐 ConnectSphere</Link>
        <Link to="/dashboard" className="text-sm text-gray-400 hover:text-brand-400">← Dashboard</Link>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-10 space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">{room.name}</h1>
            <p className="text-sm text-gray-500 mt-1">
              {room.memberCount} member{room.memberCount === 1 ? "" : "s"}
            </p>
          </div>
          <Button variant="secondary" onClick={copyCode}>
            {copied ? "Copied ✓" : `Invite code: ${room.code}`}
          </Button>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-10 text-center">
          <p className="text-4xl mb-3">🎥</p>
          <h2 className="font-semibold text-lg">Video calls land here in Phase 3</h2>
          <p className="text-gray-500 text-sm mt-2 max-w-md mx-auto">
            This room is ready — share the invite code so teammates can join.
            The mediasoup video layer, chat, and whiteboard attach to this page next.
          </p>
        </div>
      </main>
    </div>
  );
}
