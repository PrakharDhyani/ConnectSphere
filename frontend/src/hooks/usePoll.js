/**
 * Client half of in-room polls. Mirrors useRoomChat's lifecycle: subscribe to
 * `poll:state`, and re-sync on every `connect` (a reconnect means a brand-new
 * server socket that missed any broadcasts while we were away).
 */
import { useCallback, useEffect, useState } from "react";
import { connectSocket, getSocket } from "@/lib/socket.js";

const emitAck = (ev, arg) => new Promise((resolve) => getSocket().emit(ev, arg, resolve));

export function usePoll(roomId) {
  const [poll, setPoll] = useState(null);

  useEffect(() => {
    if (!roomId) return;
    const socket = connectSocket();

    const onState = (p) => p.roomId === roomId && setPoll(p.poll);
    // room:join must complete before poll:sync passes the membership check; the
    // join is issued by useRoomChat on the same "connect" tick, so defer a beat.
    const sync = () =>
      setTimeout(() => {
        socket.emit("poll:sync", roomId, (ack) => ack?.ok && setPoll(ack.poll));
      }, 400);

    socket.on("poll:state", onState);
    socket.on("connect", sync);
    if (socket.connected) sync();

    return () => {
      socket.off("poll:state", onState);
      socket.off("connect", sync);
    };
  }, [roomId]);

  const create = useCallback(
    async ({ question, options, durationSec }) => {
      const ack = await emitAck("poll:create", { roomId, question, options, durationSec });
      if (ack?.ok) getSocket().emit("room:announce", { roomId, activity: "poll" });
      return ack;
    },
    [roomId]
  );

  const vote = useCallback((optionIdx) => emitAck("poll:vote", { roomId, optionIdx }), [roomId]);
  const close = useCallback(() => emitAck("poll:close", { roomId }), [roomId]);

  return { poll, create, vote, close };
}
