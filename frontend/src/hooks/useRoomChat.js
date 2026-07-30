/**
 * All the real-time wiring for one room, in one hook.
 *
 * On mount: load history over REST, connect the socket, join the room, and
 * subscribe to live events. On unmount: leave and unsubscribe. Sending a
 * message does NOT optimistically append — the server broadcasts `message:new`
 * back to everyone in the room INCLUDING the sender, so we render it once when
 * that echo arrives (no duplicates, and we get the server's id + timestamp).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api.js";
import { connectSocket, getSocket } from "@/lib/socket.js";

export function useRoomChat(roomId) {
  const [messages, setMessages] = useState([]);
  const [presence, setPresence] = useState([]);
  const [typingName, setTypingName] = useState(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(null);
  const typingTimer = useRef(null);

  useEffect(() => {
    if (!roomId) return;
    let active = true;
    const socket = connectSocket();

    api
      .get(`/rooms/${roomId}/messages`)
      .then((res) => active && setMessages(res.data.data.messages))
      .catch(() => {});

    const onNew = (m) => m.roomId === roomId && setMessages((prev) => [...prev, m]);
    const onPresence = (p) => p.roomId === roomId && setPresence(p.users);
    const onTyping = (t) => {
      if (t.roomId !== roomId) return;
      setTypingName(t.user.name);
      clearTimeout(typingTimer.current);
      typingTimer.current = setTimeout(() => setTypingName(null), 2500);
    };

    socket.on("message:new", onNew);
    socket.on("presence:update", onPresence);
    socket.on("typing", onTyping);

    // Socket.io reconnects with a BRAND-NEW server-side socket whose `rooms`
    // set is empty — so the room must be re-joined on EVERY connect, not just
    // the first. (With `once`, a backend restart or network blip silently left
    // the client outside the room: chat, games and presence all stopped working
    // while the UI still looked connected.)
    const join = () =>
      socket.emit("room:join", roomId, (ack) => {
        if (!active) return;
        if (ack?.ok) { setReady(true); setError(null); }
        else setError(ack?.error || "Could not join room");
      });
    socket.on("connect", join);
    if (socket.connected) join();

    return () => {
      active = false;
      socket.emit("room:leave", roomId, () => {});
      socket.off("connect", join);
      socket.off("message:new", onNew);
      socket.off("presence:update", onPresence);
      socket.off("typing", onTyping);
      clearTimeout(typingTimer.current);
    };
  }, [roomId]);

  const sendMessage = useCallback(
    (text) =>
      new Promise((resolve) =>
        getSocket().emit("message:send", { roomId, text }, resolve)
      ),
    [roomId]
  );

  const notifyTyping = useCallback(() => getSocket().emit("typing", roomId), [roomId]);

  return { messages, presence, typingName, ready, error, sendMessage, notifyTyping };
}
