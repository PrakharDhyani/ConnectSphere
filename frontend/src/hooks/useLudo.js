import { useCallback, useEffect, useState } from "react";
import { connectSocket, getSocket } from "@/lib/socket.js";
import { useAuthStore } from "@/stores/auth.store.js";
import { COLORS } from "@/games/ludoBoard.js";

export function useLudo(roomId) {
  const me = useAuthStore((s) => s.user);
  const [state, setState] = useState(null);
  const [floats, setFloats] = useState([]); // live emoji reactions
  const [notices, setNotices] = useState([]); // AFK/system messages

  useEffect(() => {
    if (!roomId) return;
    const socket = connectSocket();
    const onState = (s) => setState(s);
    // Every reaction floats for ~3s then cleans itself up.
    const onEmoji = (e) => {
      setFloats((f) => [...f.slice(-11), { ...e, left: 8 + Math.random() * 76 }]);
      setTimeout(() => setFloats((f) => f.filter((x) => x.id !== e.id)), 3200);
    };
    const onNotice = ({ text }) =>
      setNotices((n) => [...n.slice(-5), { id: `${Date.now()}-${Math.random()}`, text }]);

    socket.on("ludo:state", onState);
    socket.on("ludo:emoji", onEmoji);
    socket.on("ludo:notice", onNotice);
    socket.emit("ludo:sync", { roomId }, (s) => setState(s || null));
    return () => {
      socket.off("ludo:state", onState);
      socket.off("ludo:emoji", onEmoji);
      socket.off("ludo:notice", onNotice);
    };
  }, [roomId]);

  const sendEmoji = useCallback(
    (emoji) => getSocket().emit("ludo:emoji", { roomId, emoji }),
    [roomId]
  );

  const join = useCallback(() => new Promise((r) => getSocket().emit("ludo:join", { roomId }, r)), [roomId]);
  const leave = useCallback(() => getSocket().emit("ludo:leave", { roomId }), [roomId]);
  const start = useCallback(
    () =>
      new Promise((r) =>
        getSocket().emit("ludo:start", { roomId }, (res) => {
          if (res?.ok) getSocket().emit("room:announce", { roomId, activity: "ludo" });
          r(res);
        })
      ),
    [roomId]
  );
  const roll = useCallback(() => getSocket().emit("ludo:roll", { roomId }), [roomId]);
  const move = useCallback((token) => getSocket().emit("ludo:move", { roomId, token }), [roomId]);
  const reset = useCallback(() => getSocket().emit("ludo:reset", { roomId }), [roomId]);
  const addBot = useCallback(
    (difficulty) => new Promise((r) => getSocket().emit("ludo:addBot", { roomId, difficulty }, r)),
    [roomId]
  );
  const removeBot = useCallback(
    (color) => new Promise((r) => getSocket().emit("ludo:removeBot", { roomId, color }, r)),
    [roomId]
  );

  const myColor = state ? COLORS.find((c) => state.seats?.[c]?.id === me?.id) || null : null;
  const isMyTurn = state?.status === "playing" && state.turn === myColor && !state.winner;

  return { state, me, myColor, isMyTurn, join, leave, start, roll, move, reset, addBot, removeBot, floats, notices, sendEmoji };
}
