/**
 * Direct messages: the inbox, and one open thread.
 *
 * Two hooks, because they have genuinely different lifetimes. `useConversations`
 * is the inbox — it must stay live for the whole session so a badge updates
 * while you are doing something else. `useConversation(id)` is one open thread,
 * mounted and unmounted as you move between them.
 *
 * WHY THE INBOX LISTENS TO SOCKETS RATHER THAN POLLING
 * A DM is delivered to `user:<id>`, so it arrives whether or not the thread is
 * open — which is exactly what an unread badge needs. Polling would make the
 * badge lag by up to the poll interval, and the socket is already connected.
 * React-query still owns the initial load and the cache; the socket only
 * invalidates it.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api.js";
import { connectSocket, getSocket } from "@/lib/socket.js";
import { useAuthStore } from "@/stores/auth.store.js";

/** The inbox: every thread, with previews and unread counts. */
export function useConversations() {
  const qc = useQueryClient();

  const conversations = useQuery({
    queryKey: ["conversations"],
    queryFn: async () => (await api.get("/conversations")).data.data.conversations,
  });

  useEffect(() => {
    const socket = connectSocket();
    // Any DM event can change a preview or an unread count, so all three
    // invalidate the same list. Refetching a small list is cheaper than
    // hand-patching the cache and getting the ordering subtly wrong.
    const refresh = () => qc.invalidateQueries({ queryKey: ["conversations"] });
    socket.on("dm:new", refresh);
    socket.on("dm:read", refresh);
    socket.on("dm:deleted", refresh);
    return () => {
      socket.off("dm:new", refresh);
      socket.off("dm:read", refresh);
      socket.off("dm:deleted", refresh);
    };
  }, [qc]);

  /** Open (or reopen) the thread with someone — idempotent server-side. */
  const open = useMutation({
    mutationFn: async (userId) =>
      (await api.post("/conversations", { userId })).data.data.conversation,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["conversations"] }),
  });

  const clear = useMutation({
    mutationFn: (id) => api.delete(`/conversations/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["conversations"] }),
  });

  const list = conversations.data || [];
  const totalUnread = list.reduce((n, c) => n + (c.unread || 0), 0);

  return { conversations, list, totalUnread, open, clear };
}

/**
 * One open thread: history, live messages, typing, and the send/edit/delete
 * actions.
 */
export function useConversation(conversationId) {
  const me = useAuthStore((s) => s.user);
  const qc = useQueryClient();
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [typing, setTyping] = useState(null);
  const typingTimer = useRef(null);

  // Load history whenever the open thread changes.
  useEffect(() => {
    if (!conversationId) {
      setMessages([]);
      setLoading(false);
      return undefined;
    }
    let active = true;
    setLoading(true);
    setError(null);
    api
      .get(`/conversations/${conversationId}/messages`)
      .then((res) => {
        if (!active) return;
        setMessages(res.data.data.messages);
        setLoading(false);
      })
      .catch((e) => {
        if (!active) return;
        setError(e?.response?.data?.error?.message || "Could not load this conversation");
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [conversationId]);

  // Live events for THIS thread. Everything is filtered on conversationId —
  // the socket delivers every DM to this user, not just the open one.
  useEffect(() => {
    if (!conversationId) return undefined;
    const socket = connectSocket();
    const mine = (p) => String(p?.conversationId) === String(conversationId);

    const onNew = (m) => {
      if (!mine(m)) return;
      // Guard against a double-add: the sender gets its own message from the
      // send ack, and a second device would also receive dm:new.
      setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
    };
    const onEdited = (u) => {
      if (!mine(u)) return;
      setMessages((prev) =>
        prev.map((m) => (m.id === u.id ? { ...m, text: u.text, editedAt: u.editedAt } : m))
      );
    };
    const onDeleted = (u) => {
      if (!mine(u)) return;
      setMessages((prev) =>
        u.scope === "me"
          ? prev.filter((m) => m.id !== u.id)
          : prev.map((m) =>
              m.id === u.id ? { ...m, text: "", attachments: [], deletedAt: u.deletedAt } : m
            )
      );
    };
    const onTyping = (p) => {
      if (!mine(p)) return;
      setTyping(p.user?.name || null);
      clearTimeout(typingTimer.current);
      typingTimer.current = setTimeout(() => setTyping(null), 2500);
    };

    socket.on("dm:new", onNew);
    socket.on("dm:edited", onEdited);
    socket.on("dm:deleted", onDeleted);
    socket.on("dm:typing", onTyping);
    return () => {
      socket.off("dm:new", onNew);
      socket.off("dm:edited", onEdited);
      socket.off("dm:deleted", onDeleted);
      socket.off("dm:typing", onTyping);
      clearTimeout(typingTimer.current);
    };
  }, [conversationId]);

  /**
   * Mark read on open and whenever a new message lands while open.
   *
   * Reading is a separate call from fetching history on purpose: the client
   * decides when messages were actually SEEN, and a thread fetched in the
   * background has not been.
   */
  useEffect(() => {
    if (!conversationId || loading) return;
    api
      .post(`/conversations/${conversationId}/read`)
      .then(() => qc.invalidateQueries({ queryKey: ["conversations"] }))
      .catch(() => {
        /* a read receipt failing must never break the thread */
      });
  }, [conversationId, loading, messages.length, qc]);

  const send = useCallback(
    (text, attachments = []) =>
      new Promise((resolve) => {
        const body = (text || "").trim();
        if (!conversationId || (!body && attachments.length === 0)) {
          return resolve({ ok: false, error: "Message cannot be empty" });
        }
        getSocket().emit("dm:send", { conversationId, text: body, attachments }, (res) => {
          // The sender is NOT echoed its own message (that would double it), so
          // append from the ack.
          if (res?.ok && res.message) {
            setMessages((prev) => (prev.some((x) => x.id === res.message.id) ? prev : [...prev, res.message]));
          }
          resolve(res || { ok: false });
        });
      }),
    [conversationId]
  );

  const edit = useCallback(
    (messageId, text) =>
      new Promise((resolve) => getSocket().emit("dm:edit", { messageId, text }, resolve)),
    []
  );

  const remove = useCallback(
    (messageId, scope = "me") =>
      new Promise((resolve) => getSocket().emit("dm:delete", { messageId, scope }, resolve)),
    []
  );

  const notifyTyping = useCallback(() => {
    if (conversationId) getSocket().emit("dm:typing", { conversationId });
  }, [conversationId]);

  return { me, messages, loading, error, typing, send, edit, remove, notifyTyping };
}
