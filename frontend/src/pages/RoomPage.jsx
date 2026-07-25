import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api.js";
import { useAuthStore } from "@/stores/auth.store.js";
import { useRoomChat } from "@/hooks/useRoomChat.js";
import Button from "@/components/ui/Button.jsx";

// Full literal class strings per size — Tailwind only generates classes it can
// see as complete tokens, so `w-${n}` would silently produce no CSS.
const AVATAR_SIZES = { sm: "w-7 h-7", md: "w-8 h-8" };

function Avatar({ user, size = "md" }) {
  const cls = `${AVATAR_SIZES[size]} rounded-full object-cover shrink-0`;
  return user?.avatarUrl ? (
    <img src={user.avatarUrl} alt="" className={cls} />
  ) : (
    <span className={`${cls} bg-brand-900 flex items-center justify-center text-xs font-bold text-brand-200`}>
      {user?.name?.[0]?.toUpperCase() ?? "?"}
    </span>
  );
}

export default function RoomPage() {
  const { roomId } = useParams();
  const me = useAuthStore((s) => s.user);
  const [copied, setCopied] = useState(false);
  const [draft, setDraft] = useState("");
  const scrollRef = useRef(null);

  const { data: room, isLoading, error } = useQuery({
    queryKey: ["room", roomId],
    queryFn: async () => (await api.get(`/rooms/${roomId}`)).data.data.room,
    retry: false,
  });

  const { messages, presence, typingName, error: chatError, sendMessage, notifyTyping } =
    useRoomChat(room ? roomId : null);

  // Auto-scroll to the newest message.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, typingName]);

  async function copyCode() {
    await navigator.clipboard.writeText(room.code).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleSend(e) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    const ack = await sendMessage(text);
    if (!ack?.ok) setDraft(text); // restore on failure so nothing is lost
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
    <div className="min-h-screen flex flex-col">
      <header className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
        <Link to="/dashboard" className="text-xl font-bold text-brand-400">🌐 ConnectSphere</Link>
        <Link to="/dashboard" className="text-sm text-gray-400 hover:text-brand-400">← Dashboard</Link>
      </header>

      <div className="flex-1 max-w-5xl w-full mx-auto px-4 py-6 grid md:grid-cols-[1fr_220px] gap-4">
        {/* Chat column */}
        <section className="flex flex-col bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden min-h-[70vh]">
          <div className="flex items-center justify-between px-5 py-3 border-b border-gray-800">
            <div>
              <h1 className="font-bold">{room.name}</h1>
              <p className="text-xs text-gray-500">{presence.length} online</p>
            </div>
            <Button variant="secondary" onClick={copyCode}>
              {copied ? "Copied ✓" : `Invite: ${room.code}`}
            </Button>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
            {messages.length === 0 && (
              <p className="text-gray-500 text-sm text-center mt-8">
                No messages yet — say hello 👋
              </p>
            )}
            {messages.map((m) => {
              const mine = m.sender?.id === me?.id;
              return (
                <div key={m.id} className={`flex gap-2 ${mine ? "flex-row-reverse" : ""}`}>
                  <Avatar user={m.sender} />
                  <div className={`max-w-[75%] ${mine ? "text-right" : ""}`}>
                    <p className="text-xs text-gray-500 mb-0.5">
                      {mine ? "You" : m.sender?.name}{" "}
                      <span className="opacity-60">
                        {new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </p>
                    <p className={`inline-block px-3 py-2 rounded-2xl text-sm break-words ${
                      mine ? "bg-brand-600 text-white" : "bg-gray-800 text-gray-100"
                    }`}>
                      {m.text}
                    </p>
                  </div>
                </div>
              );
            })}
            {typingName && (
              <p className="text-xs text-gray-500 italic">{typingName} is typing…</p>
            )}
          </div>

          {chatError && <p className="px-5 py-2 text-sm text-red-400">{chatError}</p>}

          <form onSubmit={handleSend} className="flex gap-2 p-3 border-t border-gray-800">
            <input
              value={draft}
              onChange={(e) => { setDraft(e.target.value); notifyTyping(); }}
              placeholder="Type a message…"
              maxLength={2000}
              className="flex-1 px-3 py-2 rounded-lg bg-gray-950 border border-gray-700 text-white
                placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            <Button type="submit" disabled={!draft.trim()}>Send</Button>
          </form>
        </section>

        {/* Presence sidebar */}
        <aside className="bg-gray-900 border border-gray-800 rounded-2xl p-4 h-fit">
          <h2 className="text-sm font-semibold text-gray-300 mb-3">
            Online — {presence.length}
          </h2>
          <ul className="space-y-2">
            {presence.map((u) => (
              <li key={u.id} className="flex items-center gap-2 text-sm">
                <span className="relative">
                  <Avatar user={u} size="sm" />
                  <span className="absolute bottom-0 right-0 w-2 h-2 rounded-full bg-green-500 border border-gray-900" />
                </span>
                <span className="text-gray-300">{u.id === me?.id ? "You" : u.name}</span>
              </li>
            ))}
            {presence.length === 0 && <li className="text-xs text-gray-500">Connecting…</li>}
          </ul>

          <p className="text-xs text-gray-600 mt-6 border-t border-gray-800 pt-3">
            🎥 Video calls attach to this room next.
          </p>
        </aside>
      </div>
    </div>
  );
}
