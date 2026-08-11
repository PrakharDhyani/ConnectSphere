/**
 * Direct messages — the inbox on the left, the open thread on the right.
 *
 * RESPONSIVE BY COLLAPSE, NOT BY A SECOND LAYOUT. On a phone this is one column
 * at a time: the list, or the thread with a back arrow. Two independent layouts
 * would be two things to keep in sync; here the same markup is shown or hidden,
 * so a change to a message bubble cannot fix desktop and miss mobile.
 */
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useConversations, useConversation } from "@/hooks/useDirectMessages.js";
import Avatar from "@/components/Avatar.jsx";
import Button from "@/components/ui/Button.jsx";
import Input from "@/components/ui/Input.jsx";
import Logo from "@/components/Logo.jsx";

/** "14:03" for today, "Mon" this week, otherwise a date. */
function shortTime(value) {
  if (!value) return "";
  const d = new Date(value);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (now - d < 7 * 24 * 60 * 60 * 1000) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { day: "numeric", month: "short" });
}

/** The one-line preview in the list — attachment-only messages have no text. */
function previewOf(last) {
  if (!last) return "No messages yet";
  if (last.kind === "deleted") return "Message deleted";
  if (last.text) return last.text;
  const label = { image: "📷 Photo", video: "🎬 Video", voice: "🎤 Voice note", audio: "🎵 Audio", file: "📎 File", gif: "GIF", sticker: "Sticker" };
  return label[last.kind] || "Attachment";
}

export default function MessagesPage() {
  const [params, setParams] = useSearchParams();
  const activeId = params.get("c");
  const { list, conversations, clear } = useConversations();

  const active = list.find((c) => String(c.id) === String(activeId)) || null;

  return (
    <div className="min-h-screen flex flex-col">
      <header className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
        <Link to="/dashboard"><Logo /></Link>
        <Link to="/friends" className="text-sm text-gray-400 hover:text-brand-400">Friends →</Link>
      </header>

      <main className="flex-1 max-w-5xl w-full mx-auto md:grid md:grid-cols-[18rem_1fr] md:gap-4 px-4 py-6 min-h-0">
        {/* ── Inbox ── hidden on mobile once a thread is open */}
        <section className={`${activeId ? "hidden md:flex" : "flex"} flex-col bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden`}>
          <h1 className="px-4 py-3 font-semibold border-b border-gray-800">Messages</h1>
          {conversations.isLoading ? (
            <p className="p-4 text-sm text-gray-500">Loading…</p>
          ) : list.length === 0 ? (
            <p className="p-4 text-sm text-gray-500">
              No conversations yet. Open one from your{" "}
              <Link to="/friends" className="text-brand-400 hover:underline">friends list</Link>.
            </p>
          ) : (
            <ul className="overflow-y-auto divide-y divide-gray-800">
              {list.map((c) => (
                <li key={c.id}>
                  <button
                    onClick={() => setParams({ c: String(c.id) })}
                    className={`w-full text-left px-4 py-3 hover:bg-gray-800/60 ${String(c.id) === String(activeId) ? "bg-gray-800/80" : ""}`}
                  >
                    <span className="flex items-center gap-3">
                      <Avatar user={c.user} size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="text-sm text-gray-100 truncate">{c.user?.name || "Unknown"}</span>
                          <span className="text-[11px] text-gray-500 shrink-0">{shortTime(c.lastMessage?.at)}</span>
                        </span>
                        <span className="flex items-center justify-between gap-2">
                          <span className={`text-xs truncate ${c.unread ? "text-gray-200" : "text-gray-500"}`}>
                            {c.lastMessage?.mine ? "You: " : ""}{previewOf(c.lastMessage)}
                          </span>
                          {c.unread > 0 && (
                            <span className="shrink-0 min-w-[1.25rem] text-center text-[11px] font-semibold bg-brand-500 text-white rounded-full px-1.5 py-0.5">
                              {c.unread > 99 ? "99+" : c.unread}
                            </span>
                          )}
                        </span>
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── Thread ── hidden on mobile until one is chosen */}
        <section className={`${activeId ? "flex" : "hidden md:flex"} flex-col bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden min-h-[60vh]`}>
          {activeId ? (
            <Thread
              conversationId={activeId}
              other={active?.user}
              onBack={() => setParams({})}
              onClear={() => {
                clear.mutate(activeId);
                setParams({});
              }}
            />
          ) : (
            <p className="m-auto text-sm text-gray-500">Pick a conversation</p>
          )}
        </section>
      </main>
    </div>
  );
}

function Thread({ conversationId, other, onBack, onClear }) {
  const { me, messages, loading, error, typing, send, remove, notifyTyping } =
    useConversation(conversationId);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(null);
  const bottomRef = useRef(null);

  // Stick to the newest message, including when one arrives live.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, typing]);

  async function submit(e) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setFailed(null);
    // Clear optimistically so typing feels instant; restore if the send failed,
    // because silently losing what someone typed is unforgivable.
    setDraft("");
    const res = await send(text);
    setSending(false);
    if (!res?.ok) {
      setDraft(text);
      setFailed(res?.error || "Could not send");
    }
  }

  return (
    <>
      <header className="flex items-center gap-3 px-4 py-3 border-b border-gray-800">
        <button onClick={onBack} className="md:hidden text-gray-400 hover:text-gray-200" aria-label="Back">←</button>
        {other && <Avatar user={other} size="sm" />}
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-medium text-gray-100 truncate">{other?.name || "Conversation"}</span>
          {typing && <span className="block text-[11px] text-brand-400">typing…</span>}
        </span>
        <button onClick={onClear} className="text-xs text-gray-500 hover:text-red-400" title="Clears this conversation for you only">
          Clear
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {loading && <p className="text-sm text-gray-500">Loading…</p>}
        {error && <p className="text-sm text-red-400">{error}</p>}
        {!loading && !error && messages.length === 0 && (
          <p className="text-sm text-gray-500">No messages yet — say hello.</p>
        )}
        {messages.map((m) => {
          const mine = String(m.sender?.id) === String(me?.id);
          return (
            <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div className={`group max-w-[75%] rounded-2xl px-3 py-2 ${mine ? "bg-brand-600 text-white" : "bg-gray-800 text-gray-100"}`}>
                {m.deletedAt ? (
                  <p className="text-sm italic opacity-60">Message deleted</p>
                ) : (
                  <p className="text-sm whitespace-pre-wrap break-words">{m.text}</p>
                )}
                <span className="flex items-center gap-2 mt-0.5">
                  <span className={`text-[10px] ${mine ? "text-white/60" : "text-gray-500"}`}>
                    {shortTime(m.createdAt)}{m.editedAt ? " · edited" : ""}
                  </span>
                  {!m.deletedAt && (
                    <button
                      onClick={() => remove(m.id, mine ? "everyone" : "me")}
                      className={`opacity-0 group-hover:opacity-100 text-[10px] ${mine ? "text-white/70 hover:text-white" : "text-gray-500 hover:text-red-400"}`}
                      // Only the author may withdraw a message for both sides;
                      // the other person can only hide it from their own view.
                      title={mine ? "Delete for everyone" : "Delete for me"}
                    >
                      delete
                    </button>
                  )}
                </span>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={submit} className="flex items-center gap-2 px-4 py-3 border-t border-gray-800">
        <Input
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            notifyTyping();
          }}
          placeholder="Message…"
          maxLength={2000}
          className="flex-1"
        />
        <Button type="submit" disabled={!draft.trim() || sending}>Send</Button>
      </form>
      {failed && <p className="px-4 pb-3 text-xs text-red-400">{failed}</p>}
    </>
  );
}
