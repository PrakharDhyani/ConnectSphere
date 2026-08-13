import { useEffect, useRef, useState } from "react";

/**
 * ⋯ The per-message action menu: edit · copy · pin · forward · delete.
 *
 * Which actions appear is decided here rather than in the menu items, so the
 * rules live in one readable place:
 *   edit            — your own, non-deleted, text messages
 *   copy            — anything with text
 *   pin / unpin     — room owner only (the pin bar is a room-wide surface)
 *   forward         — public rooms only (see chat.handlers for the reasoning)
 *   delete for me   — anyone, always
 *   delete for all  — your own message, or the room owner moderating
 */
export default function MessageActions({
  message,
  isMine,
  isOwner,
  isPublicRoom,
  onEdit,
  onPin,
  onForward,
  onDelete,
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (!ref.current?.contains(e.target)) { setOpen(false); setConfirmDelete(false); } };
    const onKey = (e) => e.key === "Escape" && (setOpen(false), setConfirmDelete(false));
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const deleted = Boolean(message.deletedAt);

  async function copy() {
    try {
      await navigator.clipboard.writeText(message.text || "");
      setCopied(true);
      setTimeout(() => { setCopied(false); setOpen(false); }, 900);
    } catch {
      setOpen(false);
    }
  }

  const run = (fn) => () => { setOpen(false); setConfirmDelete(false); fn?.(); };

  const Item = ({ icon, label, onClick, danger, hint }) => (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-xs transition-colors ${
        danger ? "text-red-300 hover:bg-red-950/40" : "text-gray-200 hover:bg-white/5"
      }`}
    >
      <span className="w-4 text-center">{icon}</span>
      <span className="flex-1">{label}</span>
      {hint && <span className="text-[9px] text-gray-500">{hint}</span>}
    </button>
  );

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Message actions"
        className={`w-6 h-6 rounded-md text-gray-500 hover:text-gray-200 hover:bg-white/10 text-sm leading-none transition-opacity ${
          open ? "opacity-100 bg-white/10" : "opacity-0 group-hover:opacity-100"
        }`}
      >
        ⋯
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-44 rounded-xl border border-gray-700 bg-gray-900/97 backdrop-blur shadow-2xl overflow-hidden py-1">
          {!deleted && isMine && message.text && (
            <Item icon="✏️" label="Edit" onClick={run(onEdit)} />
          )}
          {!deleted && message.text && (
            <Item icon="📋" label={copied ? "Copied!" : "Copy text"} onClick={copy} />
          )}
          {!deleted && isOwner && (
            <Item
              icon="📌"
              label={message.pinnedAt ? "Unpin" : "Pin"}
              onClick={run(() => onPin(!message.pinnedAt))}
            />
          )}
          {!deleted && isPublicRoom && (
            <Item icon="↪️" label="Forward" onClick={run(onForward)} />
          )}

          <div className="my-1 h-px bg-gray-800" />

          {!confirmDelete ? (
            <Item icon="🗑️" label="Delete…" onClick={() => setConfirmDelete(true)} danger />
          ) : (
            <>
              <p className="px-3 py-1 text-[10px] uppercase tracking-wide text-gray-500">Delete</p>
              <Item icon="🙈" label="For me" onClick={run(() => onDelete("me"))} danger />
              {(isMine || isOwner) && !deleted && (
                <Item
                  icon="💥"
                  label="For everyone"
                  hint={!isMine && isOwner ? "mod" : undefined}
                  onClick={run(() => onDelete("everyone"))}
                  danger
                />
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
