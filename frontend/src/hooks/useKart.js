import { useCallback, useEffect, useRef, useState } from "react";
import { connectSocket, getSocket } from "@/lib/socket.js";
import { useAuthStore } from "@/stores/auth.store.js";

/**
 * Client side of Smash Karts. The server streams world snapshots at ~15 Hz —
 * far too fast to drive React re-renders — so live snapshots land in `snapRef`
 * (the canvas render loop reads it every frame). React state is only used for
 * coarse view changes: lobby ↔ playing ↔ ended, and the player list shown on
 * the lobby / scoreboard screens.
 */
export function useKart(roomId) {
  const me = useAuthStore((s) => s.user);
  const snapRef = useRef({ prev: null, cur: null, at: 0 }); // for interpolation
  const killFeedRef = useRef([]); // [{ text, at }] — drawn on the canvas
  const boomsRef = useRef([]); // [{ x, y, at, consumed }] — bomb blasts to render
  const [status, setStatus] = useState("lobby");
  const [view, setView] = useState(null); // snapshot for lobby/ended UI
  // Errors from guarded actions surface in the UI instead of being swallowed
  // (a silent `{error}` ack looked exactly like "the button does nothing").
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!roomId) return;
    const socket = connectSocket();

    const onState = (s) => {
      snapRef.current = { prev: snapRef.current.cur, cur: s, at: performance.now() };
      setStatus((prev) => (prev !== s.status ? s.status : prev));
      // Only re-render the React tree when NOT mid-match (lobby/ended need the
      // live roster); during play the canvas owns everything.
      if (s.status !== "playing") setView(s);
    };
    const onKill = ({ killerName, victimName }) => {
      killFeedRef.current.push({ text: `${killerName} 💥 ${victimName}`, at: performance.now() });
      if (killFeedRef.current.length > 5) killFeedRef.current.shift();
    };
    const onBoom = ({ x, y }) => {
      boomsRef.current.push({ x, y, consumed: false });
      if (boomsRef.current.length > 8) boomsRef.current.shift();
    };

    const sync = () =>
      socket.emit("kart:sync", { roomId }, (s) => {
        if (!s) return;
        snapRef.current = { prev: null, cur: s, at: performance.now() };
        setStatus(s.status);
        setView(s);
      });

    socket.on("kart:state", onState);
    socket.on("kart:kill", onKill);
    socket.on("kart:boom", onBoom);
    // Re-sync after a reconnect too — the arena may have started/ended while
    // we were disconnected (useRoomChat re-joins the socket room on connect).
    socket.on("connect", sync);
    sync();

    return () => {
      socket.off("kart:state", onState);
      socket.off("kart:kill", onKill);
      socket.off("kart:boom", onBoom);
      socket.off("connect", sync);
    };
  }, [roomId]);

  const run = useCallback(
    (event) =>
      new Promise((resolve) =>
        getSocket().emit(event, { roomId }, (res) => {
          setError(res?.error || null);
          resolve(res);
        })
      ),
    [roomId]
  );
  const join = useCallback(() => run("kart:join"), [run]);
  const leave = useCallback(() => getSocket().emit("kart:leave", { roomId }), [roomId]);
  const start = useCallback(
    () =>
      run("kart:start").then((res) => {
        if (res?.ok) getSocket().emit("room:announce", { roomId, activity: "kart" });
        return res;
      }),
    [run, roomId]
  );
  const reset = useCallback(() => getSocket().emit("kart:reset", { roomId }), [roomId]);
  const sendInput = useCallback((input) => getSocket().emit("kart:input", { roomId, input }), [roomId]);
  const setConfig = useCallback(
    (cfg) => getSocket().emit("kart:config", { roomId, ...cfg }),
    [roomId]
  );

  const joined = Boolean(view?.players?.some((p) => p.id === me?.id));
  const isHost = view?.hostId === me?.id;

  return { me, status, view, snapRef, killFeedRef, boomsRef, joined, isHost, error, join, leave, start, reset, sendInput, setConfig };
}
