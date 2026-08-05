import { useEffect, useState } from "react";
import { getSocket } from "@/lib/socket.js";

/**
 * 📞 "N people are in this call — tap to join", shown to everyone in the room
 * who is NOT already in the call.
 *
 * The roster arrives two ways, and it needs both: `call:state` broadcasts on
 * every join/leave, and the `room:join` ack carries the current state so a
 * late arrival sees a call that started before they opened the room. Without
 * the second, the banner would only appear if someone happened to join or
 * leave while you were watching.
 */
export function useCallState(roomId, { inCall } = {}) {
  const [state, setState] = useState({ active: false, participants: [], count: 0 });

  useEffect(() => {
    if (!roomId) return;
    const socket = getSocket();

    const onState = (p) => {
      if (p.roomId !== roomId) return;
      setState({ active: p.active, participants: p.participants || [], count: p.count || 0 });
    };
    socket.on("call:state", onState);

    // Ask explicitly too — covers a reconnect, where the join ack already fired.
    const ask = () => socket.emit("call:get", roomId, (res) => {
      if (res && !res.error) setState({ active: res.active, participants: res.participants || [], count: res.count || 0 });
    });
    if (socket.connected) ask();
    socket.on("connect", ask);

    return () => {
      socket.off("call:state", onState);
      socket.off("connect", ask);
    };
  }, [roomId]);

  // Never nag someone who is already in the call.
  return { ...state, show: state.active && !inCall };
}

export default function CallBanner({ call, roomId, onJoin }) {
  const { participants, count, show } = useCallState(roomId, { inCall: call.inCall });
  if (!show) return null;

  const names = participants.slice(0, 3).map((p) => p.name).join(", ");
  const more = count - Math.min(3, participants.length);

  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-gradient-to-r from-green-950/70 to-emerald-950/50 border-b border-green-900/60">
      <span className="relative flex h-2.5 w-2.5 shrink-0">
        <span className="absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-70 animate-ping" />
        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-sm text-green-200 font-medium truncate">
          📞 {count === 1 ? "1 person is" : `${count} people are`} in the call
        </p>
        {names && (
          <p className="text-[11px] text-green-400/80 truncate">
            {names}{more > 0 ? ` and ${more} more` : ""}
          </p>
        )}
      </div>

      {/* Avatar pile — a glance tells you whether it's worth joining. */}
      <div className="hidden sm:flex -space-x-2 shrink-0">
        {participants.slice(0, 4).map((p) =>
          p.avatarUrl ? (
            <img key={p.id} src={p.avatarUrl} alt="" className="w-7 h-7 rounded-full border-2 border-green-950 object-cover" />
          ) : (
            <span key={p.id} className="w-7 h-7 rounded-full border-2 border-green-950 bg-green-800 text-green-100 text-[10px] font-bold flex items-center justify-center">
              {p.name?.[0]?.toUpperCase() || "?"}
            </span>
          )
        )}
      </div>

      <button
        onClick={onJoin}
        disabled={call.joining}
        className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold bg-green-600 hover:bg-green-500 text-white shadow disabled:opacity-60"
      >
        {call.joining ? "Joining…" : "Tap to join"}
      </button>
    </div>
  );
}
