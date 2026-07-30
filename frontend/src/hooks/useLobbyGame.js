/**
 * Client twin of the backend lobby-game framework: one hook drives chess,
 * UNO, typing and bingo. State/private/notices arrive on `${prefix}:*`
 * events; `act(name, payload)` sends game moves.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { connectSocket, getSocket } from "@/lib/socket.js";
import { useAuthStore } from "@/stores/auth.store.js";

export function useLobbyGame(prefix, roomId, extraEvents = {}) {
  const me = useAuthStore((s) => s.user);
  const [state, setState] = useState(null);
  const [priv, setPriv] = useState(null); // your secret slice (hand, card…)
  const [notices, setNotices] = useState([]);
  const extraRef = useRef(extraEvents);
  extraRef.current = extraEvents;

  useEffect(() => {
    if (!roomId) return;
    const socket = connectSocket();
    const onState = (s) => setState(s);
    const onPrivate = (p) => setPriv(p);
    const onNotice = ({ text }) =>
      setNotices((n) => [...n.slice(-5), { id: `${Date.now()}-${Math.random()}`, text }]);

    socket.on(`${prefix}:state`, onState);
    socket.on(`${prefix}:private`, onPrivate);
    socket.on(`${prefix}:notice`, onNotice);

    const extraNames = Object.keys(extraRef.current);
    const wrapped = {};
    for (const name of extraNames) {
      wrapped[name] = (payload) => extraRef.current[name]?.(payload);
      socket.on(`${prefix}:${name}`, wrapped[name]);
    }

    const sync = () =>
      socket.emit(`${prefix}:sync`, { roomId }, (s) => {
        if (!s) return;
        setState(s);
        if (s.you) setPriv(s.you);
      });
    socket.on("connect", sync);
    sync();

    return () => {
      socket.off(`${prefix}:state`, onState);
      socket.off(`${prefix}:private`, onPrivate);
      socket.off(`${prefix}:notice`, onNotice);
      socket.off("connect", sync);
      for (const name of extraNames) socket.off(`${prefix}:${name}`, wrapped[name]);
    };
  }, [prefix, roomId]);

  const emitAck = useCallback(
    (event, payload = {}) =>
      new Promise((resolve) => getSocket().emit(`${prefix}:${event}`, { roomId, ...payload }, resolve)),
    [prefix, roomId]
  );

  const join = useCallback(() => emitAck("join"), [emitAck]);
  const leave = useCallback(() => emitAck("leave"), [emitAck]);
  const start = useCallback(
    () =>
      emitAck("start").then((res) => {
        if (res?.ok) getSocket().emit("room:announce", { roomId, activity: prefix });
        return res;
      }),
    [emitAck, prefix, roomId]
  );
  const reset = useCallback(() => emitAck("reset"), [emitAck]);
  const addBot = useCallback((difficulty) => emitAck("addBot", { difficulty }), [emitAck]);
  const removeBot = useCallback((botId) => emitAck("removeBot", { botId }), [emitAck]);
  const act = useCallback((event, payload) => emitAck(event, payload), [emitAck]);

  const seated = Boolean(state?.players?.some((p) => p.id === me?.id));
  const isHost = state?.hostId === me?.id;

  return { me, state, priv, notices, seated, isHost, join, leave, start, reset, addBot, removeBot, act };
}
