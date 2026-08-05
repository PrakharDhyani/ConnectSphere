import { useEffect, useState } from "react";
import { api } from "@/lib/api.js";

/**
 * 📜 House rules — written by the owner, visible to everyone.
 *
 * Two jobs: let the owner state expectations, and give moderation something to
 * point at. The kick/ban dialogs pre-fill from these, so "you broke rule 3"
 * beats an unexplained removal.
 *
 * The "please read" prompt is versioned by `rulesUpdatedAt`: the client stores
 * the timestamp it last acknowledged, so editing the rules re-prompts everyone
 * without any per-user rows in the database.
 */
const ackKey = (roomId) => `groot:rules:ack:${roomId}`;

export function useRulesAck(roomId, rulesUpdatedAt, hasRules) {
  const [acknowledged, setAcknowledged] = useState(true);

  useEffect(() => {
    if (!roomId || !hasRules || !rulesUpdatedAt) return setAcknowledged(true);
    try {
      const seen = localStorage.getItem(ackKey(roomId));
      setAcknowledged(seen === String(new Date(rulesUpdatedAt).getTime()));
    } catch {
      setAcknowledged(true); // private mode — don't nag on every render
    }
  }, [roomId, rulesUpdatedAt, hasRules]);

  const acknowledge = () => {
    try {
      localStorage.setItem(ackKey(roomId), String(new Date(rulesUpdatedAt).getTime()));
    } catch { /* ignore */ }
    setAcknowledged(true);
  };

  return { acknowledged, acknowledge };
}

/** The "rules updated — please read" gate shown above the chat. */
export function RulesPrompt({ rules, onAccept }) {
  return (
    <div className="px-4 py-3 bg-amber-950/30 border-b border-amber-900/50">
      <p className="text-sm font-semibold text-amber-200 mb-1.5">📜 House rules</p>
      <ol className="space-y-0.5 mb-2 list-decimal list-inside">
        {rules.map((r, i) => (
          <li key={i} className="text-xs text-amber-100/90">{r}</li>
        ))}
      </ol>
      <button
        onClick={onAccept}
        className="px-3 py-1 rounded-lg text-xs font-medium bg-amber-600 hover:bg-amber-500 text-white"
      >
        Got it
      </button>
    </div>
  );
}

/** Sidebar panel: read the rules; owners can edit them. */
export default function RoomRules({ room, roomId, onChanged }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const rules = room.rules || [];

  function startEdit() {
    setDraft(rules.length ? [...rules] : [""]);
    setEditing(true);
    setError(null);
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const items = draft.map((r) => r.trim()).filter(Boolean);
      await api.put(`/rooms/${roomId}/rules`, { items });
      setEditing(false);
      onChanged?.();
    } catch (err) {
      setError(err.response?.data?.error?.message || "Could not save the rules");
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <div className="border-t border-gray-800 pt-3 space-y-2">
        <p className="text-xs uppercase tracking-wide text-gray-500">📜 Room rules</p>
        {draft.map((r, i) => (
          <div key={i} className="flex gap-1">
            <span className="text-[10px] text-gray-600 pt-2 w-3">{i + 1}.</span>
            <input
              value={r}
              maxLength={200}
              onChange={(e) => setDraft(draft.map((d, j) => (j === i ? e.target.value : d)))}
              placeholder="e.g. No spoilers"
              className="flex-1 min-w-0 px-2 py-1 rounded bg-gray-950 border border-gray-700 text-white text-xs focus:outline-none focus:border-brand-500"
            />
            <button
              type="button"
              onClick={() => setDraft(draft.filter((_, j) => j !== i))}
              className="text-gray-600 hover:text-red-400 text-xs px-1"
            >
              ✕
            </button>
          </div>
        ))}
        {draft.length < 20 && (
          <button
            type="button"
            onClick={() => setDraft([...draft, ""])}
            className="text-[11px] text-brand-400 hover:text-brand-300"
          >
            + Add a rule
          </button>
        )}
        {error && <p className="text-[11px] text-red-400">{error}</p>}
        <div className="flex gap-1.5">
          <button
            onClick={save}
            disabled={busy}
            className="flex-1 py-1 rounded-lg text-xs font-medium bg-brand-600 hover:bg-brand-500 text-white disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save rules"}
          </button>
          <button
            onClick={() => setEditing(false)}
            className="px-2 py-1 rounded-lg text-xs border border-gray-700 text-gray-400 hover:border-gray-500"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="border-t border-gray-800 pt-3">
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-xs uppercase tracking-wide text-gray-500">📜 Room rules</p>
        {room.isOwner && (
          <button onClick={startEdit} className="text-[11px] text-gray-500 hover:text-brand-400">
            {rules.length ? "edit" : "add"}
          </button>
        )}
      </div>
      {rules.length ? (
        <ol className="space-y-1 list-decimal list-inside">
          {rules.map((r, i) => (
            <li key={i} className="text-[11px] text-gray-400 leading-snug">{r}</li>
          ))}
        </ol>
      ) : (
        <p className="text-[11px] text-gray-600">
          {room.isOwner ? "Set expectations for this room." : "No rules set."}
        </p>
      )}
    </div>
  );
}
