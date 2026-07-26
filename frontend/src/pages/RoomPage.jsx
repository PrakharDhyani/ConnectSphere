import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api.js";
import { getSocket } from "@/lib/socket.js";
import { useAuthStore } from "@/stores/auth.store.js";
import { useRoomChat } from "@/hooks/useRoomChat.js";
import { useMediaRoom } from "@/hooks/useMediaRoom.js";
import VideoTile from "@/components/VideoTile.jsx";
import GamesHub from "@/components/GamesHub.jsx";
import VoiceBar from "@/components/VoiceBar.jsx";
import Button from "@/components/ui/Button.jsx";

const ACT_LABEL = {
  call: "started the call 📞",
  board: "opened the whiteboard 🖊️",
  skribbl: "started Draw & Guess 🎨",
  ludo: "started Ludo 🎲",
};
const ACT_VIEW = { call: "room", board: "board", skribbl: "game", ludo: "game" };

// Excalidraw is heavy (~1.8 MB) — load it only when the whiteboard is opened.
const WhiteboardPanel = lazy(() => import("@/components/WhiteboardPanel.jsx"));

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
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const me = useAuthStore((s) => s.user);
  const [copied, setCopied] = useState(false);
  const [draft, setDraft] = useState("");
  const [view, setView] = useState("room"); // "room" | "board" | "game"
  const [toasts, setToasts] = useState([]);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [actionError, setActionError] = useState(null);
  const scrollRef = useRef(null);

  const { data: room, isLoading, error } = useQuery({
    queryKey: ["room", roomId],
    queryFn: async () => (await api.get(`/rooms/${roomId}`)).data.data.room,
    retry: false,
  });

  const { messages, presence, typingName, error: chatError, sendMessage, notifyTyping } =
    useRoomChat(room ? roomId : null);

  const call = useMediaRoom(room ? roomId : null);

  // Activity notifications: someone started a call/board/game in this room.
  useEffect(() => {
    const socket = getSocket();
    const onNotify = ({ activity, name }) => {
      const id = `${Date.now()}-${Math.random()}`;
      setToasts((t) => [...t.slice(-3), { id, activity, name }]);
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
    };
    socket.on("room:notify", onNotify);
    return () => socket.off("room:notify", onNotify);
  }, []);

  // React to room-lifecycle events pushed over the socket (see room.controller).
  useEffect(() => {
    if (!room) return;
    const socket = getSocket();
    const refresh = (p) => p.roomId === roomId && queryClient.invalidateQueries({ queryKey: ["room", roomId] });
    const onClosed = (p) => {
      if (p.roomId !== roomId) return;
      queryClient.invalidateQueries({ queryKey: ["rooms"] });
      navigate("/dashboard", { state: { message: "That room was closed by its owner." } });
    };
    socket.on("room:updated", refresh);
    socket.on("room:members-changed", refresh);
    socket.on("room:closed", onClosed);
    return () => {
      socket.off("room:updated", refresh);
      socket.off("room:members-changed", refresh);
      socket.off("room:closed", onClosed);
    };
  }, [room, roomId, queryClient, navigate]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, typingName]);

  const renameMut = useMutation({
    mutationFn: (name) => api.patch(`/rooms/${roomId}`, { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["room", roomId] });
      queryClient.invalidateQueries({ queryKey: ["rooms"] });
      setEditingName(false);
    },
    onError: (err) => setActionError(err.response?.data?.error?.message || "Rename failed"),
  });

  const leaveMut = useMutation({
    mutationFn: () => api.post(`/rooms/${roomId}/leave`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rooms"] });
      navigate("/dashboard", { state: { message: "You left the room." } });
    },
    onError: (err) => setActionError(err.response?.data?.error?.message || "Could not leave"),
  });

  const deleteMut = useMutation({
    mutationFn: () => api.delete(`/rooms/${roomId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rooms"] });
      navigate("/dashboard", { state: { message: "Room deleted." } });
    },
    onError: (err) => setActionError(err.response?.data?.error?.message || "Could not delete"),
  });

  // Copy a full shareable link (not just the code) — anyone who opens it lands
  // on /join/:code and can hop straight in, as a guest or with an account.
  async function copyLink() {
    const link = `${window.location.origin}/join/${room.code}`;
    await navigator.clipboard.writeText(link).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleSend(e) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    const ack = await sendMessage(text);
    if (!ack?.ok) setDraft(text);
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

  const onlineIds = new Set(presence.map((p) => p.id));
  const nameFor = (userId) => room.members.find((m) => m.id === userId)?.name || "Guest";

  return (
    <div className="min-h-screen flex flex-col">
      {/* Persistent mic/call bar — available on every tab */}
      <VoiceBar call={call} />

      {/* Activity notifications */}
      <div className="fixed top-4 right-4 z-40 space-y-2 w-64">
        {toasts.map((t) => (
          <button
            key={t.id}
            onClick={() => {
              setView(ACT_VIEW[t.activity] || "room");
              setToasts((x) => x.filter((y) => y.id !== t.id));
            }}
            className="block w-full text-left bg-gray-900 border border-brand-800 rounded-xl px-4 py-2 text-sm shadow-lg hover:border-brand-500 transition-colors"
          >
            <span><b className="text-brand-300">{t.name}</b> {ACT_LABEL[t.activity] || "started an activity"}</span>
            <span className="block text-xs text-gray-500">Tap to join →</span>
          </button>
        ))}
      </div>

      <header className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-gray-800 gap-2">
        <Link to={me?.isGuest ? "/" : "/dashboard"} className="text-xl font-bold text-brand-400 shrink-0">🌐</Link>
        <div className="flex items-center gap-1 sm:gap-2">
          <Button variant={view === "room" ? "primary" : "secondary"} onClick={() => setView("room")}>💬 Room</Button>
          <Button variant={view === "board" ? "primary" : "secondary"} onClick={() => setView("board")}>🖊️ Board</Button>
          <Button variant={view === "game" ? "primary" : "secondary"} onClick={() => setView("game")}>🎮 Game</Button>
        </div>
        <Link to={me?.isGuest ? "/" : "/dashboard"} className="text-sm text-gray-400 hover:text-brand-400 shrink-0 hidden sm:block">
          {me?.isGuest ? "← Home" : "← Dash"}
        </Link>
      </header>

      {view === "board" && (
        <div className="flex-1 w-full max-w-7xl mx-auto px-2 sm:px-4 py-4">
          <Suspense
            fallback={
              <div className="flex items-center justify-center h-[75vh]">
                <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
              </div>
            }
          >
            <WhiteboardPanel roomId={roomId} />
          </Suspense>
        </div>
      )}

      {view === "game" && (
        <div className="flex-1 w-full max-w-7xl mx-auto px-2 sm:px-4 py-4">
          <GamesHub roomId={roomId} />
        </div>
      )}

      <div className={`flex-1 max-w-6xl w-full mx-auto px-4 py-6 grid md:grid-cols-[1fr_260px] gap-4 ${view !== "room" ? "hidden" : ""}`}>
        {/* Chat column */}
        <section className="flex flex-col bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden min-h-[70vh]">
          <div className="flex items-center justify-between px-5 py-3 border-b border-gray-800 gap-3">
            {editingName ? (
              <form
                className="flex items-center gap-2 flex-1"
                onSubmit={(e) => { e.preventDefault(); if (nameDraft.trim().length >= 2) renameMut.mutate(nameDraft.trim()); }}
              >
                <input
                  autoFocus
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  maxLength={100}
                  className="flex-1 px-2 py-1 rounded bg-gray-950 border border-gray-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
                <Button type="submit" loading={renameMut.isPending}>Save</Button>
                <button type="button" onClick={() => setEditingName(false)} className="text-sm text-gray-400 hover:text-gray-200">Cancel</button>
              </form>
            ) : (
              <div className="min-w-0">
                <h1 className="font-bold truncate flex items-center gap-2">
                  {room.name}
                  {room.isOwner && (
                    <button
                      onClick={() => { setNameDraft(room.name); setEditingName(true); setActionError(null); }}
                      className="text-xs text-gray-500 hover:text-brand-400"
                      title="Rename room"
                    >
                      ✎
                    </button>
                  )}
                </h1>
                <p className="text-xs text-gray-500">{presence.length} online · {room.memberCount} member{room.memberCount === 1 ? "" : "s"}</p>
              </div>
            )}
            <div className="flex items-center gap-2 shrink-0">
              {call.inCall ? (
                <Button variant="danger" onClick={call.leaveCall}>Leave call</Button>
              ) : (
                <Button onClick={call.joinCall} loading={call.joining}>Join call</Button>
              )}
              <Button variant="secondary" onClick={copyLink}>{copied ? "Copied ✓" : "🔗 Copy invite link"}</Button>
            </div>
          </div>

          {call.inCall && (
            <div className="border-b border-gray-800 p-3 bg-gray-950/40">
              {/* Screen shares — big, on top */}
              {(call.screenStream || call.remotes.some((r) => r.source === "screen")) && (
                <div className="space-y-2 mb-2">
                  {call.screenStream && (
                    <VideoTile stream={call.screenStream} label="Your screen" muted big />
                  )}
                  {call.remotes
                    .filter((r) => r.source === "screen")
                    .map((r) => (
                      <VideoTile key={r.key} stream={r.stream} label={`${nameFor(r.userId)}'s screen`} big />
                    ))}
                </div>
              )}

              {/* Camera tiles */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {call.localStream && <VideoTile stream={call.localStream} label="You" muted mirror />}
                {call.remotes
                  .filter((r) => r.source === "camera")
                  .map((r) => (
                    <VideoTile key={r.key} stream={r.stream} label={nameFor(r.userId)} />
                  ))}
              </div>

              <div className="flex items-center justify-center flex-wrap gap-2 mt-3">
                <Button variant="secondary" onClick={call.toggleMic}>{call.micOn ? "🎤 Mute" : "🔇 Unmute"}</Button>
                <Button variant="secondary" onClick={call.toggleCam}>{call.camOn ? "📷 Cam off" : "🎥 Cam on"}</Button>
                {call.sharingScreen ? (
                  <Button variant="danger" onClick={call.stopScreenShare}>🛑 Stop share</Button>
                ) : (
                  <Button variant="secondary" onClick={call.startScreenShare}>🖥️ Share screen</Button>
                )}
              </div>
            </div>
          )}
          {call.error && <p className="px-5 py-2 text-sm text-red-400">{call.error}</p>}

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
            {messages.length === 0 && (
              <p className="text-gray-500 text-sm text-center mt-8">No messages yet — say hello 👋</p>
            )}
            {messages.map((m) => {
              const mine = m.sender?.id === me?.id;
              return (
                <div key={m.id} className={`flex gap-2 ${mine ? "flex-row-reverse" : ""}`}>
                  <Avatar user={m.sender} />
                  <div className={`max-w-[75%] ${mine ? "text-right" : ""}`}>
                    <p className="text-xs text-gray-500 mb-0.5">
                      {mine ? "You" : m.sender?.name || "Guest"}{" "}
                      <span className="opacity-60">
                        {new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </p>
                    <p className={`inline-block px-3 py-2 rounded-2xl text-sm break-words ${mine ? "bg-brand-600 text-white" : "bg-gray-800 text-gray-100"}`}>
                      {m.text}
                    </p>
                  </div>
                </div>
              );
            })}
            {typingName && <p className="text-xs text-gray-500 italic">{typingName} is typing…</p>}
          </div>

          {chatError && <p className="px-5 py-2 text-sm text-red-400">{chatError}</p>}

          <form onSubmit={handleSend} className="flex gap-2 p-3 border-t border-gray-800">
            <input
              value={draft}
              onChange={(e) => { setDraft(e.target.value); notifyTyping(); }}
              placeholder="Type a message…"
              maxLength={2000}
              className="flex-1 px-3 py-2 rounded-lg bg-gray-950 border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            <Button type="submit" disabled={!draft.trim()}>Send</Button>
          </form>
        </section>

        {/* Members + actions sidebar */}
        <aside className="bg-gray-900 border border-gray-800 rounded-2xl p-4 h-fit space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-gray-300 mb-3">Members — {room.memberCount}</h2>
            <ul className="space-y-2">
              {room.members.map((u) => {
                const online = onlineIds.has(u.id);
                return (
                  <li key={u.id} className="flex items-center gap-2 text-sm">
                    <span className="relative">
                      <Avatar user={u} size="sm" />
                      <span className={`absolute bottom-0 right-0 w-2 h-2 rounded-full border border-gray-900 ${online ? "bg-green-500" : "bg-gray-600"}`} />
                    </span>
                    <span className="text-gray-300 truncate">{u.id === me?.id ? "You" : u.name}</span>
                    {u.isOwner && <span className="text-[10px] uppercase tracking-wide text-brand-400 border border-brand-800 rounded px-1">owner</span>}
                  </li>
                );
              })}
            </ul>
          </div>

          {actionError && <p className="text-xs text-red-400">{actionError}</p>}

          <div className="border-t border-gray-800 pt-3 space-y-2">
            {room.isOwner ? (
              <Button
                variant="danger"
                className="w-full"
                loading={deleteMut.isPending}
                onClick={() => { if (window.confirm("Delete this room and all its messages? This can't be undone.")) deleteMut.mutate(); }}
              >
                Delete room
              </Button>
            ) : (
              <Button
                variant="secondary"
                className="w-full"
                loading={leaveMut.isPending}
                onClick={() => { if (window.confirm("Leave this room?")) leaveMut.mutate(); }}
              >
                Leave room
              </Button>
            )}
            <p className="text-xs text-gray-600 pt-1">🎥 Video calls attach to this room next.</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
