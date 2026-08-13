/**
 * Sticky Notes — client.
 *
 * The first panel in the app that talks ONLY through the plugin SDK. Every
 * other panel imports socket.js and emits its own bespoke event names; this one
 * knows nothing about socket.io, room keys, or the wire format. If the platform
 * ever needs to change how activities reach the server, this file does not
 * change with it — that is the whole point of the SDK boundary.
 *
 * OPTIMISTIC ONLY FOR DRAGGING, NOWHERE ELSE.
 * Dragging updates local position immediately, because a note that lags the
 * cursor feels broken. Everything else waits for the server's broadcast, so
 * there is one source of truth for what is on the board. Optimistic creation
 * would mean rendering a note the server might refuse (the board is full) and
 * having it vanish a moment later.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useActivitySdk } from "../useActivitySdk.js";
import { useAuthStore } from "@/stores/auth.store.js";

const COLORS = ["yellow", "pink", "blue", "green", "purple", "orange"];

// Full literal class strings per colour — Tailwind only generates classes it
// can see as complete tokens, so `bg-${color}-200` would produce no CSS at all.
const COLOR_CLASS = {
  yellow: "bg-yellow-200 border-yellow-300 text-yellow-950",
  pink: "bg-pink-200 border-pink-300 text-pink-950",
  blue: "bg-sky-200 border-sky-300 text-sky-950",
  green: "bg-emerald-200 border-emerald-300 text-emerald-950",
  purple: "bg-violet-200 border-violet-300 text-violet-950",
  orange: "bg-orange-200 border-orange-300 text-orange-950",
};
const SWATCH_CLASS = {
  yellow: "bg-yellow-300",
  pink: "bg-pink-300",
  blue: "bg-sky-300",
  green: "bg-emerald-300",
  purple: "bg-violet-300",
  orange: "bg-orange-300",
};

const NOTE_W = 176; // px — must match w-44 below, used to convert drag deltas
const NOTE_H = 176;

export default function StickyNotesPanel({ roomId }) {
  const me = useAuthStore((s) => s.user);
  const { sdk, state, status, error } = useActivitySdk("sticky-notes", roomId, { user: me });

  const [notes, setNotes] = useState([]);
  const [draft, setDraft] = useState("");
  const [color, setColor] = useState("yellow");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const boardRef = useRef(null);

  // The board's own state arrives with the join ack, not a separate fetch —
  // one access-controlled round trip instead of two.
  useEffect(() => {
    if (state?.notes) setNotes(state.notes);
  }, [state]);

  /**
   * Server broadcasts. Subscriptions are torn down by sdk.destroy() on unmount,
   * so this effect only has to worry about re-subscribing when the sdk changes.
   */
  useEffect(() => {
    if (!sdk?.socket) return undefined;
    const offs = [
      sdk.socket.on("created", ({ note }) =>
        // Guard against a duplicate if the ack and the broadcast race.
        setNotes((prev) => (prev.some((n) => n.id === note.id) ? prev : [...prev, note]))
      ),
      sdk.socket.on("edited", ({ id, text, color: c }) =>
        setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, text, color: c } : n)))
      ),
      sdk.socket.on("moved", ({ id, pos }) =>
        setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, pos } : n)))
      ),
      sdk.socket.on("removed", ({ id }) => setNotes((prev) => prev.filter((n) => n.id !== id))),
    ];
    return () => offs.forEach((off) => off());
  }, [sdk]);

  const flash = useCallback((msg) => {
    setNotice(msg);
    setTimeout(() => setNotice(null), 3000);
  }, []);

  const addNote = async (e) => {
    e?.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    // Stagger new notes so they do not stack exactly on top of each other.
    const pos = { x: 0.08 + Math.random() * 0.55, y: 0.1 + Math.random() * 0.5 };
    const res = await sdk.socket.emit("create", { text, color, pos });
    setBusy(false);
    if (res?.error) return flash(res.error);
    setDraft("");
  };

  const removeNote = async (id) => {
    const res = await sdk.socket.emit("remove", { id });
    if (res?.error) flash(res.error);
  };

  /**
   * Pointer-based dragging.
   *
   * Pointer events rather than mouse events so it works with touch and stylus
   * from one code path.
   *
   * THE TEXTAREA COVERS ALMOST THE WHOLE NOTE, so "ignore drags that start on a
   * textarea" left the note effectively undraggable — there was a ~20px strip of
   * grabbable surface at the edges. A real pointer drag found this instantly;
   * the socket tests never could, because they call `move` directly.
   *
   * So: drag from ANYWHERE, and let the textarea take over only once the note
   * is actually being edited (it is `readOnly` until then for non-authors, and
   * focus is what distinguishes "I want to type here" from "I grabbed the note"
   * for the author). Buttons still opt out — the delete × must stay clickable.
   */
  const startDrag = (note) => (e) => {
    if (e.target.closest("button")) return;
    // Already typing in this note: let the caret and text selection work.
    if (e.target.tagName === "TEXTAREA" && document.activeElement === e.target) return;
    // Otherwise a press anywhere starts a drag. preventDefault stops the
    // textarea from stealing focus and turning the gesture into a selection.
    e.preventDefault();
    const board = boardRef.current;
    if (!board) return;

    // Captured NOW, not read inside onUp: React nulls `currentTarget` once the
    // handler returns, so the deferred pointerup would call
    // releasePointerCapture on null and throw mid-gesture.
    const card = e.currentTarget;
    card.setPointerCapture(e.pointerId);

    const rect = board.getBoundingClientRect();
    const grabX = e.clientX - (rect.left + note.pos.x * (rect.width - NOTE_W));
    const grabY = e.clientY - (rect.top + note.pos.y * (rect.height - NOTE_H));

    const startX = e.clientX;
    const startY = e.clientY;
    const textarea = card.querySelector("textarea");
    let latest = note.pos;
    let dragged = false;

    const onMove = (ev) => {
      // A few pixels of slack: a "click" is never perfectly still, and treating
      // 1px of jitter as a drag would make the note impossible to type in.
      if (!dragged && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 4) return;
      dragged = true;
      const x = (ev.clientX - grabX - rect.left) / Math.max(1, rect.width - NOTE_W);
      const y = (ev.clientY - grabY - rect.top) / Math.max(1, rect.height - NOTE_H);
      latest = { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
      // Local-only during the drag: sending every pointer move would be a flood
      // and the server echo would fight the cursor.
      setNotes((prev) => prev.map((n) => (n.id === note.id ? { ...n, pos: latest } : n)));
    };
    const onUp = (ev) => {
      try { card.releasePointerCapture?.(ev.pointerId); } catch { /* already released */ }
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (dragged) {
        // One write at the end of the gesture, not 60 per second.
        sdk.socket.emit("move", { id: note.id, pos: latest });
      } else if (mine.has(note.id)) {
        // A tap that never moved is an intent to type, not to drag. Focusing
        // here rather than letting the textarea do it natively is the cost of
        // preventDefault above — but it is what makes "drag from anywhere"
        // possible without losing the ability to edit.
        textarea?.focus();
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const saveText = (note) => (e) => {
    const text = e.target.value;
    if (text === note.text) return;
    sdk.socket.emit("edit", { id: note.id, text });
    setNotes((prev) => prev.map((n) => (n.id === note.id ? { ...n, text } : n)));
  };

  const showAuthors = sdk?.meta?.config?.showAuthors !== false;
  const mine = useMemo(() => new Set(notes.filter((n) => n.authorId === me?.id).map((n) => n.id)), [notes, me]);

  if (status === "error") {
    return (
      <div className="max-w-md mx-auto mt-10 bg-gray-900 border border-gray-800 rounded-2xl p-6 text-center">
        <div className="text-3xl mb-2">📝</div>
        <h3 className="font-bold mb-1">Sticky Notes unavailable</h3>
        <p className="text-sm text-gray-400">{error}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 gap-3">
      {/* Composer */}
      <form onSubmit={addNote} className="shrink-0 flex flex-wrap items-center gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Write a note…"
          maxLength={280}
          className="flex-1 min-w-[12rem] px-4 py-2 rounded-xl bg-gray-900 border border-gray-800 text-sm focus:outline-none focus:border-brand-500"
        />
        <div className="flex items-center gap-1">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              aria-label={c}
              aria-pressed={color === c}
              className={`w-6 h-6 rounded-full ${SWATCH_CLASS[c]} transition-transform ${
                color === c ? "ring-2 ring-white scale-110" : "opacity-70 hover:opacity-100"
              }`}
            />
          ))}
        </div>
        <button
          type="submit"
          disabled={!draft.trim() || busy || status !== "ready"}
          className="px-4 py-2 rounded-xl bg-gradient-to-r from-brand-600 to-fuchsia-600 text-sm font-medium disabled:opacity-40"
        >
          Add note
        </button>
      </form>

      {notice && (
        <div className="shrink-0 text-sm text-amber-300 bg-amber-950/40 border border-amber-900/50 rounded-lg px-3 py-2">
          {notice}
        </div>
      )}

      {/* The board. Fractional positions are resolved against its measured box,
          so the same layout holds on a phone and a 4K monitor. */}
      <div
        ref={boardRef}
        className="relative flex-1 min-h-[26rem] rounded-2xl border border-gray-800 bg-gray-950/60 overflow-hidden"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.07) 1px, transparent 0)",
          backgroundSize: "24px 24px",
        }}
      >
        {status === "connecting" && (
          <div className="absolute inset-0 grid place-items-center">
            <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {status === "ready" && notes.length === 0 && (
          <div className="absolute inset-0 grid place-items-center text-center px-6">
            <div>
              <div className="text-4xl mb-2">📝</div>
              <p className="text-gray-400 text-sm">
                No notes yet — write the first one above.
                <br />
                Drag notes around to group them.
              </p>
            </div>
          </div>
        )}

        {notes.map((note) => (
          <div
            key={note.id}
            onPointerDown={startDrag(note)}
            className={`absolute w-44 h-44 p-3 rounded-lg border shadow-lg cursor-grab active:cursor-grabbing select-none flex flex-col ${
              COLOR_CLASS[note.color] || COLOR_CLASS.yellow
            }`}
            style={{
              // Percentages of the free space (board minus the note) so a note
              // at x=1 sits flush with the right edge instead of overflowing.
              left: `calc(${note.pos.x} * (100% - ${NOTE_W}px))`,
              top: `calc(${note.pos.y} * (100% - ${NOTE_H}px))`,
            }}
          >
            <textarea
              defaultValue={note.text}
              onBlur={saveText(note)}
              readOnly={!mine.has(note.id)}
              maxLength={280}
              className="flex-1 w-full bg-transparent resize-none text-sm leading-snug focus:outline-none placeholder-black/40"
              placeholder="…"
            />
            <div className="shrink-0 flex items-center justify-between gap-2 pt-1 text-[11px] opacity-70">
              <span className="truncate">{showAuthors ? note.authorName : ""}</span>
              <button
                type="button"
                onClick={() => removeNote(note.id)}
                aria-label="Delete note"
                className="px-1.5 rounded hover:bg-black/10 font-bold"
              >
                ×
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
