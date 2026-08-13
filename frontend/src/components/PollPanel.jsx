import { useEffect, useMemo, useState } from "react";
import { useAuthStore } from "@/stores/auth.store.js";
import { usePoll } from "@/hooks/usePoll.js";
import Button from "@/components/ui/Button.jsx";

const DURATIONS = [
  [0, "No timer"],
  [60, "1 min"],
  [180, "3 min"],
  [300, "5 min"],
];

function Countdown({ endsAt }) {
  const [left, setLeft] = useState(() => Math.max(0, endsAt - Date.now()));
  useEffect(() => {
    const t = setInterval(() => setLeft(Math.max(0, endsAt - Date.now())), 1000);
    return () => clearInterval(t);
  }, [endsAt]);
  const s = Math.ceil(left / 1000);
  return (
    <span className={`text-xs tabular-nums ${s <= 10 ? "text-red-400 animate-pulse" : "text-gray-400"}`}>
      ⏳ {Math.floor(s / 60)}:{String(s % 60).padStart(2, "0")}
    </span>
  );
}

function CreateForm({ create, onDone }) {
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [durationSec, setDurationSec] = useState(180);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const setOpt = (i, v) => setOptions((o) => o.map((x, j) => (j === i ? v : x)));
  const filled = options.map((o) => o.trim()).filter(Boolean);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const ack = await create({ question: question.trim(), options: filled, durationSec });
    setBusy(false);
    if (ack?.ok) onDone();
    else setError(ack?.error || "Could not create poll");
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <input
        autoFocus
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        placeholder="What do we do next?"
        maxLength={200}
        className="w-full px-3 py-2 rounded-lg bg-gray-950 border border-gray-700 text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500"
      />
      {options.map((o, i) => (
        <div key={i} className="flex gap-2">
          <input
            value={o}
            onChange={(e) => setOpt(i, e.target.value)}
            placeholder={`Option ${i + 1}`}
            maxLength={80}
            className="flex-1 px-3 py-1.5 rounded-lg bg-gray-950 border border-gray-700 text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          {options.length > 2 && (
            <button
              type="button"
              onClick={() => setOptions((x) => x.filter((_, j) => j !== i))}
              className="text-gray-500 hover:text-red-400 px-1"
              title="Remove option"
            >
              ✕
            </button>
          )}
        </div>
      ))}
      <div className="flex items-center gap-2 flex-wrap">
        {options.length < 6 && (
          <button
            type="button"
            onClick={() => setOptions((x) => [...x, ""])}
            className="text-xs text-brand-400 hover:text-brand-300"
          >
            + Add option
          </button>
        )}
        <select
          value={durationSec}
          onChange={(e) => setDurationSec(Number(e.target.value))}
          className="ml-auto text-xs bg-gray-950 border border-gray-700 rounded-lg px-2 py-1 text-gray-300 focus:outline-none"
        >
          {DURATIONS.map(([v, label]) => (
            <option key={v} value={v}>{label}</option>
          ))}
        </select>
        <Button type="submit" loading={busy} disabled={!question.trim() || filled.length < 2}>
          Launch 🚀
        </Button>
        <button type="button" onClick={onDone} className="text-xs text-gray-400 hover:text-gray-200">
          Cancel
        </button>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </form>
  );
}

/**
 * 📊 One live poll per room. Renders as a card at the top of the chat column:
 * tap to vote (tap again to retract), bars animate as votes land in real time,
 * the creator can end it early, and finished results stay up until the next
 * poll replaces them.
 */
export default function PollPanel({ roomId }) {
  const me = useAuthStore((s) => s.user);
  const { poll, create, vote, close } = usePoll(roomId);
  const [creating, setCreating] = useState(false);
  const [dismissedId, setDismissedId] = useState(null);

  const myVote = useMemo(() => {
    if (!poll || !me) return -1;
    return poll.options.findIndex((o) => o.voters.some((v) => v.id === me.id));
  }, [poll, me]);

  // Auto-collapse the create form when the new poll arrives via poll:state.
  useEffect(() => {
    if (poll && !poll.closed) setCreating(false);
  }, [poll]);

  const showResults = poll && poll.id !== dismissedId;

  if (!creating && !showResults) {
    return (
      <button
        onClick={() => setCreating(true)}
        className="mx-3 mt-2 self-start text-xs text-gray-400 hover:text-brand-300 border border-dashed border-gray-700 hover:border-brand-600 rounded-full px-3 py-1 transition-colors"
      >
        📊 Start a poll
      </button>
    );
  }

  return (
    <div className="mx-3 mt-2 rounded-xl border border-brand-900/70 bg-gradient-to-br from-gray-950 to-brand-950/30 p-3 shadow-[0_4px_20px_rgba(139,92,246,0.12)]">
      {creating ? (
        <CreateForm create={create} onDone={() => setCreating(false)} />
      ) : (
        <>
          <div className="flex items-start justify-between gap-2 mb-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-white break-words">📊 {poll.question}</p>
              <p className="text-[11px] text-gray-500">
                by {poll.createdBy.id === me?.id ? "you" : poll.createdBy.name} · {poll.totalVotes} vote{poll.totalVotes === 1 ? "" : "s"}
                {poll.closed && <span className="text-amber-400"> · ended</span>}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {!poll.closed && poll.endsAt && <Countdown endsAt={poll.endsAt} />}
              {!poll.closed && poll.createdBy.id === me?.id && (
                <button onClick={close} className="text-xs text-gray-500 hover:text-red-400">End</button>
              )}
              {poll.closed && (
                <>
                  <button
                    onClick={() => { setDismissedId(poll.id); setCreating(true); }}
                    className="text-xs text-brand-400 hover:text-brand-300"
                  >
                    New poll
                  </button>
                  <button onClick={() => setDismissedId(poll.id)} className="text-xs text-gray-500 hover:text-gray-300" title="Dismiss">✕</button>
                </>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            {poll.options.map((o, i) => {
              const pct = poll.totalVotes ? Math.round((o.count / poll.totalVotes) * 100) : 0;
              const mine = i === myVote;
              const winner = poll.closed && o.count > 0 && o.count === Math.max(...poll.options.map((x) => x.count));
              return (
                <button
                  key={i}
                  disabled={poll.closed}
                  onClick={() => vote(i)}
                  title={o.voters.map((v) => v.name).join(", ")}
                  className={`relative w-full text-left rounded-lg border px-3 py-1.5 overflow-hidden transition-colors ${
                    mine ? "border-brand-500" : "border-gray-800"
                  } ${poll.closed ? "cursor-default" : "hover:border-brand-600"}`}
                >
                  <span
                    className={`absolute inset-y-0 left-0 transition-all duration-500 ${
                      winner ? "bg-gradient-to-r from-brand-600/50 to-fuchsia-600/40" : "bg-brand-800/30"
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                  <span className="relative flex items-center justify-between gap-2 text-sm">
                    <span className={`break-words ${mine ? "text-brand-200 font-medium" : "text-gray-200"}`}>
                      {winner && "🏆 "}{o.text}{mine && " ✓"}
                    </span>
                    <span className="text-xs text-gray-400 tabular-nums shrink-0">{o.count} · {pct}%</span>
                  </span>
                </button>
              );
            })}
          </div>
          {!poll.closed && <p className="mt-1.5 text-[10px] text-gray-600">Tap to vote — tap again to retract. Votes are public.</p>}
        </>
      )}
    </div>
  );
}
