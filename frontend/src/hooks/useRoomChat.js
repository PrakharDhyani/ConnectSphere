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
  const [recorders, setRecorders] = useState([]); // [{id,name}] currently recording
  const [pinned, setPinned] = useState([]);       // [{id,text,...}] pinned in this room
  const typingTimer = useRef(null);

  useEffect(() => {
    if (!roomId) return;
    let active = true;
    const socket = connectSocket();

    api
      .get(`/rooms/${roomId}/messages`)
      .then((res) => {
        if (!active) return;
        const list = res.data.data.messages;
        setMessages(list);
        // Seed the pin bar from history rather than a second request.
        setPinned(
          list
            .filter((m) => m.pinnedAt && !m.deletedAt)
            .sort((a, b) => new Date(b.pinnedAt) - new Date(a.pinnedAt))
            .slice(0, 5)
            .map((m) => ({ id: m.id, text: m.text, hasAttachments: (m.attachments?.length || 0) > 0 }))
        );
      })
      .catch(() => {});

    const onNew = (m) => m.roomId === roomId && setMessages((prev) => [...prev, m]);

    // Message actions mutate an existing row rather than appending — patch it
    // in place so scroll position and grouping survive.
    const patch = (id, fields) =>
      setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...fields } : m)));

    const onEdited = (p) => p.roomId === roomId && patch(p.id, { text: p.text, editedAt: p.editedAt });
    const onDeleted = (p) => {
      if (p.roomId !== roomId) return;
      // A tombstone stays in place so the conversation keeps its shape.
      patch(p.id, { deletedAt: new Date().toISOString(), text: "", attachments: [], byOwner: p.byOwner });
    };
    const onPinned = (p) => {
      if (p.roomId !== roomId) return;
      patch(p.id, { pinnedAt: p.pinned ? new Date().toISOString() : null });
      setPinned((prev) => {
        const without = prev.filter((x) => x.id !== p.id);
        return p.pinned
          ? [{ id: p.id, text: p.text, hasAttachments: p.hasAttachments, pinnedBy: p.pinnedBy }, ...without].slice(0, 5)
          : without;
      });
    };
    const onPresence = (p) => p.roomId === roomId && setPresence(p.users);
    const onTyping = (t) => {
      if (t.roomId !== roomId) return;
      setTypingName(t.user.name);
      clearTimeout(typingTimer.current);
      typingTimer.current = setTimeout(() => setTypingName(null), 2500);
    };

    const onRecording = (p) => p.roomId === roomId && setRecorders(p.recorders || []);

    socket.on("message:new", onNew);
    socket.on("message:edited", onEdited);
    socket.on("message:deleted", onDeleted);
    socket.on("message:pinned", onPinned);
    socket.on("presence:update", onPresence);
    socket.on("typing", onTyping);
    socket.on("recording:changed", onRecording);

    // Socket.io reconnects with a BRAND-NEW server-side socket whose `rooms`
    // set is empty — so the room must be re-joined on EVERY connect, not just
    // the first. (With `once`, a backend restart or network blip silently left
    // the client outside the room: chat, games and presence all stopped working
    // while the UI still looked connected.)
    const join = () =>
      socket.emit("room:join", roomId, (ack) => {
        if (!active) return;
        if (ack?.ok) {
          setReady(true);
          setError(null);
          setRecorders(ack.recorders || []); // late joiner: recording may be live
        } else setError(ack?.error || "Could not join room");
      });
    socket.on("connect", join);
    if (socket.connected) join();

    return () => {
      active = false;
      socket.emit("room:leave", roomId, () => {});
      socket.off("connect", join);
      socket.off("message:new", onNew);
      socket.off("message:edited", onEdited);
      socket.off("message:deleted", onDeleted);
      socket.off("message:pinned", onPinned);
      socket.off("presence:update", onPresence);
      socket.off("typing", onTyping);
      socket.off("recording:changed", onRecording);
      clearTimeout(typingTimer.current);
    };
  }, [roomId]);

  // `attachments` are descriptors the server re-validates (see chat.handlers.js
  // sanitizeAttachments) — uploads must already be in our storage, GIFs must be
  // provider URLs, stickers are just registry ids.
  const sendMessage = useCallback(
    (text, attachments = []) =>
      new Promise((resolve) =>
        getSocket().emit("message:send", { roomId, text, attachments }, resolve)
      ),
    [roomId]
  );

  const notifyTyping = useCallback(() => getSocket().emit("typing", roomId), [roomId]);

  // ── Message actions ────────────────────────────────────────────────────
  // Each resolves with the server's ack so the caller can surface an error.
  // The optimistic UI comes from the broadcast events above, not from here —
  // the server is the one that decides whether an action was allowed.
  const emit = useCallback(
    (event, payload) => new Promise((resolve) => getSocket().emit(event, { roomId, ...payload }, resolve)),
    [roomId]
  );

  const editMessage = useCallback((messageId, text) => emit("message:edit", { messageId, text }), [emit]);
  const pinMessage = useCallback((messageId, pinned) => emit("message:pin", { messageId, pinned }), [emit]);
  const forwardMessage = useCallback((messageId, toRoomId) => emit("message:forward", { messageId, toRoomId }), [emit]);

  const deleteMessage = useCallback(
    async (messageId, scope) => {
      const ack = await emit("message:delete", { messageId, scope });
      // "Delete for me" has no broadcast (nobody else is affected), so the
      // local list is pruned here.
      if (ack?.ok && scope === "me") setMessages((prev) => prev.filter((m) => m.id !== messageId));
      return ack;
    },
    [emit]
  );

  return {
    messages, presence, typingName, ready, error, recorders, pinned,
    sendMessage, notifyTyping,
    editMessage, deleteMessage, pinMessage, forwardMessage,
  };
}
