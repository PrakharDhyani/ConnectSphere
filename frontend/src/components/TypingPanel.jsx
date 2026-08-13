/**
 * Typing race — racetrack UI. Everyone's car advances along its lane in real
 * time; the passage renders as green (typed), red-shake (current mistake) and
 * gray (ahead), with a blinking caret. Progress reports are throttled to 4Hz;
 * the server clamps cheaters, so the UI never needs to police anyone else.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useLobbyGame } from "@/hooks/useLobbyGame.js";
import GameLobby, { SpectateBanner, NoticeFeed } from "@/components/GameLobby.jsx";
import Button from "@/components/ui/Button.jsx";
import { getSocket } from "@/lib/socket.js";
import { sfx } from "@/lib/sfx.js";

const CARS = ["🏎️", "🚗", "🚙", "🚕", "🛻", "🚓", "🚑", "🚒"];
const MEDALS = ["🥇", "🥈", "🥉"];

/** Global top-10 speed records (60s timed mode). */
function Leaderboard({ refreshKey, meId }) {
  const [top, setTop] = useState(null);
  useEffect(() => {
    getSocket().emit("typing:leaderboard", {}, (res) => {
      if (res?.ok) setTop(res.top);
    });
  }, [refreshKey]);
  if (!top) return null;
  return (
    <div className="glass-card p-4">
      <p className="text-xs uppercase tracking-wider text-arcade-300/70 mb-2 text-center">
        🌍 Global top 10 — 60s speed records
      </p>
      {top.length === 0 ? (
        <p className="text-center text-xs text-gray-600 py-2">
          No records yet — run a 60s test and claim the whole board.
        </p>
      ) : (
        <ol className="space-y-1">
          {top.map((r, i) => (
            <li
              key={r.user}
              className={`flex items-center gap-2 text-sm rounded-lg px-2 py-1 ${
                r.user === meId ? "bg-arcade-400/15 border border-arcade-400/40" : ""
              } ${i === 0 ? "text-amber-300 font-bold" : "text-gray-300"}`}
            >
              <span className="w-6 text-center">{MEDALS[i] || `${i + 1}.`}</span>
              <span className="flex-1 truncate">{r.name}{r.user === meId && " (you)"}</span>
              <span className="font-mono font-bold text-arcade-300">{r.wpm} wpm</span>
              <span className="text-[10px] text-gray-500 w-10 text-right">{r.accuracy}%</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export default function TypingPanel({ roomId }) {
  const lobby = useLobbyGame("typing", roomId);
  const { me, state, notices, isHost, act, reset } = lobby;
  const [typed, setTyped] = useState("");
  const [errors, setErrors] = useState(0);
  const [wrong, setWrong] = useState(false); // current keystroke is a mistake
  const [now, setNow] = useState(Date.now());
  const inputRef = useRef(null);
  const lastSentRef = useRef(0);
  const wentRef = useRef(false);

  const text = state?.text || "";
  const racing = state?.status === "playing" && now >= (state?.startAt || 0);
  const counting = state?.status === "playing" && now < (state?.startAt || 0);
  const meProg = state?.progress?.[me?.id];
  const finished = Boolean(meProg?.finishedAt);
  const mySeat = Boolean(state?.players?.some((p) => p.id === me?.id));

  // Clock for countdown + progress bars.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 120);
    return () => clearInterval(t);
  }, []);

  // Countdown beeps + GO.
  useEffect(() => {
    if (!counting) return;
    const secs = Math.ceil((state.startAt - now) / 1000);
    if (secs !== wentRef.current && secs <= 3 && secs > 0) {
      wentRef.current = secs;
      sfx.play("countdown");
    }
  }, [counting, now, state?.startAt]);
  useEffect(() => {
    if (racing && wentRef.current !== "go") {
      wentRef.current = "go";
      sfx.play("raceGo");
      setTyped("");
      setErrors(0);
      inputRef.current?.focus();
    }
  }, [racing]);

  // Reset local input when a new race begins.
  useEffect(() => {
    if (state?.status === "lobby") { setTyped(""); setErrors(0); wentRef.current = false; }
  }, [state?.status]);

  // Send progress (throttled) whenever correct-typed length changes.
  const correctLen = useMemo(() => {
    let n = 0;
    while (n < typed.length && typed[n] === text[n]) n++;
    return n;
  }, [typed, text]);

  useEffect(() => {
    if (!racing || finished || !mySeat) return;
    const send = () => act("progress", { chars: correctLen, errors });
    if (correctLen >= text.length && text.length > 0) { send(); return; }
    if (Date.now() - lastSentRef.current > 250) {
      lastSentRef.current = Date.now();
      send();
    }
  }, [correctLen, racing, finished, mySeat, errors, text.length, act]);

  const onType = (e) => {
    if (!racing || finished) return;
    const v = e.target.value;
    // Mistake detection: a keystroke that doesn't extend the correct prefix.
    if (v.length > typed.length) {
      const ch = v[v.length - 1];
      const expect = text[correctLen];
      if (v.length - 1 === correctLen && ch !== expect) {
        setErrors((n) => n + 1);
        setWrong(true);
        sfx.play("keyError");
      } else if (ch === " " && expect !== " ") {
        // word finished cleanly?
      } else if (expect === " " && ch === " ") {
        sfx.play("wordDone");
        setWrong(false);
      } else {
        setWrong(v.length > correctLen + 1);
      }
    } else {
      setWrong(false);
    }
    setTyped(v.slice(0, text.length + 12));
  };

  if (!state || state.status === "lobby") {
    const isHost = lobby.isHost;
    const modes = [
      { id: "race", label: "🏁 Race", desc: "a passage sprint — first to finish wins" },
      { id: "timed", label: "⏱️ 60s Test", desc: "endless random words, one minute — sets GLOBAL records" },
    ];
    return (
      <div className="max-w-md mx-auto space-y-3">
        <GameLobby
          title="TYPING RACE" emoji="⌨️"
          tagline="Same words, fastest fingers — with friends, WPM bots, or solo."
          minPlayers={1} maxPlayers={8} lobby={lobby}
        >
          <div className="mt-4 pt-4 border-t border-gray-800 text-left">
            <p className="text-xs uppercase tracking-wider text-arcade-300/70 mb-1.5">
              Mode {!isHost && <span className="text-gray-600 normal-case">(host picks)</span>}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {modes.map((m) => (
                <button
                  key={m.id}
                  disabled={!isHost}
                  onClick={() => act("setMode", { mode: m.id })}
                  className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                    (state?.raceMode || "race") === m.id
                      ? "border-arcade-300 bg-arcade-400/20 shadow-[0_0_10px_rgba(34,211,238,0.3)]"
                      : "border-gray-700 bg-gray-800"
                  } ${isHost ? "hover:border-arcade-400" : "opacity-75 cursor-default"}`}
                >
                  <span className="block text-sm font-semibold">{m.label}</span>
                  <span className="block text-[11px] text-gray-500 leading-snug">{m.desc}</span>
                </button>
              ))}
            </div>
          </div>
        </GameLobby>
        <Leaderboard refreshKey="lobby" meId={me?.id} />
      </div>
    );
  }

  const players = state.players || [];
  const countdownSec = counting ? Math.ceil((state.startAt - now) / 1000) : 0;
  const over = state.status === "ended";
  const timed = state.raceMode === "timed";
  const secondsLeft = timed ? Math.max(0, Math.ceil(((state.endAt || 0) - now) / 1000)) : null;
  // Timed mode shows a sliding WINDOW of the endless stream, not 1,600 chars
  // at once: start the window at the word ~45 chars behind the cursor.
  let winStart = 0;
  if (timed && correctLen > 45) {
    winStart = text.lastIndexOf(" ", correctLen - 45) + 1;
  }
  const winEnd = timed ? Math.min(text.length, winStart + 260) : text.length;
  const leaderChars = Math.max(1, ...players.map((p) => state.progress?.[p.id]?.chars ?? 0));

  return (
    <div className="max-w-2xl mx-auto space-y-4" onClick={() => inputRef.current?.focus()}>
      {state.status === "playing" && !mySeat && <SpectateBanner />}

      {/* Racetrack lanes */}
      <div className="bg-gray-900/70 border border-arcade-500/20 rounded-2xl p-4 space-y-2">
        {players.map((p, i) => {
          const prog = state.progress?.[p.id];
          // Race: distance through the passage. Timed: relative to the leader
          // (the stream is endless, so "percent of text" is meaningless).
          const frac = timed
            ? (prog?.chars ?? 0) / leaderChars
            : text.length ? (prog?.chars ?? 0) / text.length : 0;
          const place = prog?.finishedAt ? state.finishOrder?.indexOf(p.id) + 1 : null;
          return (
            <div key={p.id} className="relative h-9">
              {/* lane */}
              <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-5 rounded-full bg-gray-800/80 overflow-hidden">
                <div className="h-full rounded-full transition-all duration-300"
                  style={{ width: `${frac * 100}%`, background: p.id === me?.id ? "linear-gradient(90deg,#0e7490,#22d3ee)" : "linear-gradient(90deg,#374151,#6b7280)" }} />
              </div>
              {/* car */}
              <span className="absolute top-1/2 -translate-y-1/2 text-xl transition-all duration-300"
                style={{ left: `calc(${frac * 100}% - ${frac * 28}px)` }}>
                {CARS[i % CARS.length]}
              </span>
              {/* label */}
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-gray-400">
                {p.name}{p.id === me?.id && " (you)"} · <b className="text-arcade-300">{prog?.wpm ?? 0}</b> wpm
                {place ? <span className="ml-1 text-amber-300 font-bold">#{place}</span> : null}
              </span>
            </div>
          );
        })}
      </div>

      {/* Countdown / passage */}
      {counting && (
        <div className="text-center py-6">
          <span key={countdownSec} className="text-7xl font-black text-arcade-300 inline-block animate-ping-once"
            style={{ animation: "none" }}>{countdownSec}</span>
          <p className="text-gray-500 text-sm mt-2">get ready…</p>
        </div>
      )}

      {(racing || over) && (
        <>
          {/* Timed mode: the one-minute clock front and center */}
          {timed && !over && (
            <div className="text-center">
              <span className={`inline-block font-mono text-4xl font-black tabular-nums px-5 py-1 rounded-2xl border ${
                secondsLeft <= 10
                  ? "text-red-400 border-red-500/60 animate-pulse"
                  : "text-arcade-300 border-arcade-500/30"
              }`}>
                {secondsLeft}s
              </span>
            </div>
          )}
          <div className={`bg-gray-900/70 border rounded-2xl p-4 font-mono text-lg leading-relaxed select-none ${wrong ? "border-red-500/60" : "border-arcade-500/20"}`}
            style={wrong ? { animation: "typing-shake 0.15s" } : undefined}>
            <style>{`@keyframes typing-shake { 25% { transform: translateX(-3px) } 75% { transform: translateX(3px) } }`}</style>
            <span className="text-green-400">{text.slice(winStart, correctLen)}</span>
            {!finished && !over && (
              <span className={`border-l-2 ${wrong ? "border-red-400" : "border-arcade-300"} animate-pulse`} />
            )}
            <span className={wrong ? "text-red-400 bg-red-950/60 rounded" : "text-gray-500"}>
              {text.slice(correctLen, correctLen + Math.max(0, typed.length - correctLen))}
            </span>
            <span className="text-gray-500">{text.slice(correctLen + Math.max(0, typed.length - correctLen), winEnd)}</span>
            {timed && winEnd < text.length && <span className="text-gray-700"> …</span>}
          </div>

          {mySeat && !finished && !over && (
            <input
              ref={inputRef}
              value={typed}
              onChange={onType}
              autoFocus
              spellCheck={false}
              autoComplete="off"
              placeholder="Type here — go go go!"
              className="w-full bg-gray-950 border border-arcade-500/40 rounded-xl px-4 py-3 font-mono outline-none focus:border-arcade-400 focus:shadow-[0_0_12px_rgba(34,211,238,0.3)]"
            />
          )}
          {finished && !over && (
            <p className="text-center text-arcade-300 font-bold">
              🏁 Done! {meProg?.wpm} wpm — waiting for the others…
            </p>
          )}
        </>
      )}

      <NoticeFeed notices={notices} />

      {/* Podium — winner takes the race; everyone else ranked by distance */}
      {over && (
        <div className="text-center space-y-3">
          {players.length === 1 ? (
            // Solo practice: your stats, front and center.
            <div className="inline-block px-8 py-5 rounded-2xl border border-arcade-400 bg-arcade-950/40">
              <div className="text-3xl mb-1">⌨️</div>
              <div className="text-4xl font-black text-arcade-300">{meProg?.wpm ?? 0} <span className="text-lg">wpm</span></div>
              <div className="text-xs text-gray-400 mt-1">
                {timed ? "60-second test complete" : meProg?.finishedAt ? "full passage completed" : "timed out"} · {errors} mistakes
              </div>
            </div>
          ) : (
            <div className="flex justify-center gap-4">
              {(state.standings || state.finishOrder || []).slice(0, 3).map((id, i) => {
                const p = players.find((pl) => pl.id === id);
                const prog = state.progress?.[id];
                const finished = Boolean(prog?.finishedAt);
                const pct = text.length ? Math.round(((prog?.chars ?? 0) / text.length) * 100) : 0;
                return (
                  <div key={id} className={`px-4 py-3 rounded-xl border ${i === 0 ? "border-amber-400 bg-amber-950/30" : "border-gray-700 bg-gray-900"}`}>
                    <div className="text-2xl">{["🥇", "🥈", "🥉"][i]}</div>
                    <div className="text-sm font-semibold">{p?.name}</div>
                    <div className="text-xs text-arcade-300">
                      {prog?.wpm} wpm{!finished && <span className="text-gray-500"> · {pct}%</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {isHost && <Button variant="arcade" onClick={reset}>Race again</Button>}
          {/* Fresh leaderboard right after a timed run — new records show up here. */}
          {timed && <Leaderboard refreshKey={`ended-${state.endAt}`} meId={me?.id} />}
        </div>
      )}
    </div>
  );
}
