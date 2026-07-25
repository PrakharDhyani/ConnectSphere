import { useCallback, useEffect, useState } from "react";
import { connectSocket, getSocket } from "@/lib/socket.js";
import { useAuthStore } from "@/stores/auth.store.js";
import { COLORS } from "@/games/ludoBoard.js";

export function useLudo(roomId) {
  const me = useAuthStore((s) => s.user);
  const [state, setState] = useState(null);

  useEffect(() => {
    if (!roomId) return;
    const socket = connectSocket();
    const onState = (s) => setState(s);
    socket.on("ludo:state", onState);
    socket.emit("ludo:sync", { roomId }, (s) => setState(s || null));
    return () => socket.off("ludo:state", onState);
  }, [roomId]);

  const join = useCallback(() => new Promise((r) => getSocket().emit("ludo:join", { roomId }, r)), [roomId]);
  const leave = useCallback(() => getSocket().emit("ludo:leave", { roomId }), [roomId]);
  const start = useCallback(() => new Promise((r) => getSocket().emit("ludo:start", { roomId }, r)), [roomId]);
  const roll = useCallback(() => getSocket().emit("ludo:roll", { roomId }), [roomId]);
  const move = useCallback((token) => getSocket().emit("ludo:move", { roomId, token }), [roomId]);
  const reset = useCallback(() => getSocket().emit("ludo:reset", { roomId }), [roomId]);

  const myColor = state ? COLORS.find((c) => state.seats?.[c]?.id === me?.id) || null : null;
  const isMyTurn = state?.status === "playing" && state.turn === myColor && !state.winner;

  return { state, me, myColor, isMyTurn, join, leave, start, roll, move, reset };
}
