import { useEffect, useState } from "react";
import { getSocket } from "@/lib/socket.js";
import { sfx } from "@/lib/sfx.js";

/**
 * 📞 Incoming call invite — the Teams "someone rang you" toast.
 *
 * This is a DIRECT event (`user:<id>` room), not a room broadcast: the whole
 * point is to reach someone who muted the room and would never see the banner.
 * It is mounted app-wide, so it works even when you are looking at another
 * room or the dashboard.
 */
export function IncomingCallToast({ onAccept }) {
  const [ring, setRing] = useState(null);

  useEffect(() => {
    const socket = getSocket();
    const onRing = (payload) => {
      setRing(payload);
      sfx.play("home"); // audible — an explicit invite deserves more than a toast
      // Auto-dismiss so a missed call does not sit on screen forever.
      setTimeout(() => setRing((r) => (r === payload ? null : r)), 30_000);
    };
    socket.on("call:ring", onRing);
    return () => socket.off("call:ring", onRing);
  }, []);

  if (!ring) return null;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[110] w-[min(92vw,380px)] rounded-2xl border border-green-700 bg-gray-900/97 backdrop-blur shadow-2xl overflow-hidden animate-[slideUp_220ms_ease-out]">
      <style>{`@keyframes slideUp { from { transform: translate(-50%, 20px); opacity: 0 } to { transform: translate(-50%, 0); opacity: 1 } }`}</style>
      <div className="flex items-center gap-3 p-3.5">
        <span className="relative shrink-0">
          {ring.from?.avatarUrl ? (
            <img src={ring.from.avatarUrl} alt="" className="w-11 h-11 rounded-full object-cover" />
          ) : (
            <span className="w-11 h-11 rounded-full bg-green-800 text-green-100 font-bold flex items-center justify-center">
              {ring.from?.name?.[0]?.toUpperCase() || "?"}
            </span>
          )}
          <span className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-green-500 border-2 border-gray-900 animate-pulse" />
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white truncate">
            {ring.from?.name || "Someone"} is calling
          </p>
          <p className="text-[11px] text-gray-400 truncate">
            {ring.roomName} · {ring.participants?.length || 1} in the call
          </p>
        </div>

        <button
          onClick={() => setRing(null)}
          title="Dismiss"
          className="shrink-0 w-9 h-9 rounded-full bg-gray-800 hover:bg-red-600 text-gray-300 hover:text-white transition-colors"
        >
          ✕
        </button>
        <button
          onClick={() => { onAccept?.(ring); setRing(null); }}
          title="Join the call"
          className="shrink-0 w-9 h-9 rounded-full bg-green-600 hover:bg-green-500 text-white shadow"
        >
          📞
        </button>
      </div>
    </div>
  );
}

/**
 * "Invite to call" picker — ring members who are not already in the call.
 * Only offered while you are IN the call (the server enforces that too).
 */
export function InviteToCall({ roomId, members, participants, me }) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState([]);
  const [sent, setSent] = useState(null);
  const [error, setError] = useState(null);

  const inCallIds = new Set((participants || []).map((p) => p.id));
  const candidates = (members || []).filter((m) => m.id !== me?.id && !inCallIds.has(m.id));

  function toggle(id) {
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  }

  function ring() {
    setError(null);
    getSocket().emit("call:ring", { roomId, userIds: picked }, (res) => {
      if (res?.error) return setError(res.error);
      setSent(res?.rung ?? picked.length);
      setPicked([]);
      setTimeout(() => { setSent(null); setOpen(false); }, 1600);
    });
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Invite people to this call"
        className="px-4 py-2 rounded-lg text-sm font-medium border bg-gray-800 border-gray-700 text-gray-300 hover:border-green-500"
      >
        📞 Invite
      </button>

      {open && (
        <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 z-50 w-64 rounded-xl border border-gray-700 bg-gray-900/97 backdrop-blur shadow-2xl p-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-semibold text-white">Invite to call</p>
            <button onClick={() => setOpen(false)} className="text-gray-500 hover:text-gray-300 text-xs">✕</button>
          </div>

          {candidates.length === 0 ? (
            <p className="text-xs text-gray-500 py-3 text-center">Everyone is already here 🎉</p>
          ) : (
            <>
              <ul className="max-h-44 overflow-y-auto space-y-0.5 mb-2">
                {candidates.map((m) => (
                  <li key={m.id}>
                    <button
                      type="button"
                      onClick={() => toggle(m.id)}
                      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-colors ${
                        picked.includes(m.id) ? "bg-green-900/40 ring-1 ring-green-600/50" : "hover:bg-white/5"
                      }`}
                    >
                      {m.avatarUrl ? (
                        <img src={m.avatarUrl} alt="" className="w-6 h-6 rounded-full object-cover" />
                      ) : (
                        <span className="w-6 h-6 rounded-full bg-brand-900 text-brand-200 text-[10px] font-bold flex items-center justify-center">
                          {m.name?.[0]?.toUpperCase() || "?"}
                        </span>
                      )}
                      <span className="text-xs text-gray-200 truncate flex-1">{m.name}</span>
                      {picked.includes(m.id) && <span className="text-green-400 text-xs">✓</span>}
                    </button>
                  </li>
                ))}
              </ul>

              <button
                type="button"
                onClick={ring}
                disabled={!picked.length}
                className="w-full py-1.5 rounded-lg text-xs font-semibold bg-green-600 hover:bg-green-500 text-white disabled:opacity-40 disabled:cursor-default"
              >
                {sent != null ? `📞 Rang ${sent}` : `Ring ${picked.length || ""}`.trim()}
              </button>
              <p className="mt-1.5 text-[10px] text-gray-600">
                Rings them directly — reaches people who muted this room.
              </p>
            </>
          )}
          {error && <p className="mt-1.5 text-[10px] text-amber-300">⚠️ {error}</p>}
        </div>
      )}
    </div>
  );
}
