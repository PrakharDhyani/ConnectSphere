import { useEffect, useRef, useState } from "react";
import { useLudo } from "@/hooks/useLudo.js";
import LudoBoard from "@/components/LudoBoard.jsx";
import Button from "@/components/ui/Button.jsx";
import { COLORS, COLOR_HEX } from "@/games/ludoBoard.js";
import { sfx } from "@/lib/sfx.js";
import { getSocket } from "@/lib/socket.js";
import { useAuthStore } from "@/stores/auth.store.js";
import { useReactions, ReactionBar, ReactionOverlay } from "@/components/Reactions.jsx";

// Pip layout per die value on a 3×3 grid.
const PIPS = {
  1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8],
};

/** Big physical-looking die. Click = roll (when it's your turn). */
function Dice({ value, canRoll, onRoll, turnColor }) {
  const [spinning, setSpinning] = useState(false);
  const prev = useRef(value);
  useEffect(() => {
    if (value && value !== prev.current) {
      setSpinning(true);
      const t = setTimeout(() => setSpinning(false), 620);
      return () => clearTimeout(t);
    }
    prev.current = value;
  }, [value]);

  return (
    <button
      type="button"
      onClick={onRoll}
      disabled={!canRoll}
      aria-label={canRoll ? "Roll the dice" : "Dice"}
      className={`relative w-24 h-24 rounded-2xl select-none transition-transform
        ${spinning ? "ludo-dice-spin" : ""}
        ${canRoll ? "cursor-pointer hover:scale-105 ludo-dice-glow" : "cursor-default"}`}
      style={{
        background: "linear-gradient(145deg,#ffffff,#cfd6e2)",
        boxShadow: `0 6px 14px rgba(0,0,0,.55), inset 0 2px 3px rgba(255,255,255,.9), inset 0 -3px 5px rgba(0,0,0,.15)${
          turnColor ? `, 0 0 0 3px ${COLOR_HEX[turnColor]}55` : ""}`,
      }}
    >
      {value ? (
        <span className="absolute inset-2 grid grid-cols-3 grid-rows-3 place-items-center">
          {Array.from({ length: 9 }, (_, i) => (
            <span
              key={i}
              className="w-3.5 h-3.5 rounded-full"
              style={{
                background: PIPS[value]?.includes(i)
                  ? "radial-gradient(circle at 35% 30%, #3b4657, #0b1220)"
                  : "transparent",
              }}
            />
          ))}
        </span>
      ) : (
        <span className="absolute inset-0 flex items-center justify-center text-3xl font-black text-gray-500">?</span>
      )}
      {canRoll && (
        <span className="absolute -bottom-6 left-1/2 -translate-x-1/2 text-[11px] font-semibold text-arcade-300 whitespace-nowrap">
          tap to roll!
        </span>
      )}
    </button>
  );
}

/** Seconds left before the server auto-plays — pressure bar under the dice. */
function TurnTimer({ deadline }) {
  const [, force] = useState(0);
  useEffect(() => {
    if (!deadline) return;
    const t = setInterval(() => force((n) => n + 1), 250);
    return () => clearInterval(t);
  }, [deadline]);
  if (!deadline) return null;
  const left = Math.max(0, deadline - Date.now());
  const secs = Math.ceil(left / 1000);
  const frac = Math.min(1, left / 30000);
  return (
    <div className="w-24">
      <div className="h-1.5 rounded-full bg-gray-800 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{ width: `${frac * 100}%`, background: secs <= 8 ? "#ef4444" : "#22c55e" }}
        />
      </div>
      <p className={`text-center text-[11px] mt-0.5 ${secs <= 8 ? "text-red-400" : "text-gray-500"}`}>{secs}s</p>
    </div>
  );
}

/** Compact in-game chat riding the room's existing message events. */
function GameChat({ roomId }) {
  const meId = useAuthStore((s) => s.user?.id);
  const [msgs, setMsgs] = useState([]);
  const [text, setText] = useState("");
  const endRef = useRef(null);

  useEffect(() => {
    const socket = getSocket();
    const onNew = (m) => {
      if (String(m.roomId) !== String(roomId)) return;
      setMsgs((prev) => [...prev.slice(-39), m]);
    };
    socket.on("message:new", onNew);
    return () => socket.off("message:new", onNew);
  }, [roomId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [msgs]);

  const send = (e) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    getSocket().emit("message:send", { roomId, text: t }, () => {});
    setText("");
  };

  return (
    <div className="flex flex-col bg-gray-900/80 border border-gray-800 rounded-xl overflow-hidden">
      <div className="px-3 py-1.5 text-[11px] uppercase tracking-wide text-gray-500 border-b border-gray-800">Chat</div>
      <div className="h-36 overflow-y-auto px-3 py-2 space-y-1 text-sm">
        {msgs.length === 0 && <p className="text-xs text-gray-600">Say something…</p>}
        {msgs.map((m) => (
          <p key={m.id || m._id} className="leading-snug break-words">
            <span className={m.sender?.id === meId || m.sender === meId ? "text-arcade-300" : "text-gray-400"}>
              {m.sender?.name || m.senderName || "?"}:
            </span>{" "}
            <span className="text-gray-200">{m.text}</span>
          </p>
        ))}
        <div ref={endRef} />
      </div>
      <form onSubmit={send} className="flex border-t border-gray-800">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={500}
          placeholder="Message…"
          className="flex-1 bg-transparent px-3 py-2 text-sm outline-none placeholder:text-gray-600"
        />
        <button type="submit" className="px-3 text-arcade-400 hover:text-arcade-300 text-sm font-medium">Send</button>
      </form>
    </div>
  );
}

const Dot = ({ color, size = 12 }) => (
  <span style={{ background: COLOR_HEX[color], width: size, height: size }} className="inline-block rounded-full" />
);

const BOT_LEVELS = [
  { id: "easy", name: "Easy" },
  { id: "medium", name: "Medium" },
  { id: "hard", name: "Hard" },
];

export default function LudoPanel({ roomId }) {
  const { state, me, myColor, isMyTurn, join, leave, start, roll, move, reset, addBot, removeBot, notices } = useLudo(roomId);
  const [error, setError] = useState(null);
  const [botDiff, setBotDiff] = useState("medium");
  // Shared animated sticker reactions (same system as UNO/chess/bingo/typing).
  const rx = useReactions("ludo", roomId);

  // Sounds come from STATE DIFFS, so bot moves are audible exactly like human
  // ones (the server doesn't tell us who acted — the board changing does).
  const prevRef = useRef(null);
  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = state;
    if (!prev || !state || state.status !== "playing") {
      if (prev?.status === "playing" && state?.status === "ended" && state.winner) {
        sfx.play(state.winner === myColor ? "win" : "lose");
      }
      return;
    }
    if (state.dice && state.dice !== prev.dice && state.rolled && !prev.rolled) sfx.play("dice");
    if (state.turn !== prev.turn && state.turn === myColor) sfx.play("yourTurn");
    // Board diffs: capture (token sent back to yard) beats move; home chimes.
    let captured = false, homed = false, moved = false;
    for (const c of COLORS) {
      const a = prev.tokens?.[c] || [], b = state.tokens?.[c] || [];
      for (let i = 0; i < 4; i++) {
        if (a[i] > 0 && b[i] === 0) captured = true;
        else if (a[i] !== 57 && b[i] === 57) homed = true;
        else if (a[i] !== b[i]) moved = true;
      }
    }
    if (captured) sfx.play("capture");
    else if (homed) sfx.play("home");
    else if (moved) sfx.play("move");
  }, [state, myColor]);

  if (!state) {
    return <p className="text-center text-gray-500 py-8">Loading game…</p>;
  }

  const seated = COLORS.filter((c) => state.seats[c]);
  const amSeated = Boolean(myColor);
  const isHost = state.hostId === me?.id;
  const homeCount = (c) => (state.tokens[c] || []).filter((s) => s === 57).length;

  async function doJoin() {
    setError(null);
    const res = await join();
    if (res?.error) setError(res.error);
  }
  async function doStart() {
    setError(null);
    const res = await start();
    if (res?.error) setError(res.error);
  }
  async function doAddBot() {
    setError(null);
    const res = await addBot(botDiff);
    if (res?.error) setError(res.error);
  }

  // ── Lobby ──
  if (state.status === "lobby") {
    return (
      <div className="max-w-md mx-auto bg-gradient-to-b from-arcade-950/40 to-gray-900 border border-arcade-500/25 rounded-2xl p-6 text-center">
        <p className="text-4xl mb-2">🎲</p>
        <h2 className="text-xl font-black tracking-wide text-arcade-300 drop-shadow-[0_0_10px_rgba(34,211,238,0.4)]">LUDO</h2>
        <p className="text-gray-500 text-sm mt-1">Take a seat — 2 to 4 players.</p>

        <ul className="mt-4 space-y-2 text-left">
          {COLORS.map((c) => (
            <li key={c} className="flex items-center gap-2 text-sm">
              <Dot color={c} />
              <span className="capitalize text-gray-400 w-16">{c}</span>
              <span className="text-gray-200">{state.seats[c] ? state.seats[c].name : <span className="text-gray-600">empty</span>}</span>
              {state.seats[c]?.isBot && <span className="text-xs px-1.5 rounded bg-gray-800 text-gray-400">bot</span>}
              {isHost && state.seats[c]?.isBot && (
                <button onClick={() => removeBot(c)} className="ml-auto text-xs text-gray-500 hover:text-red-400" aria-label={`Remove ${state.seats[c].name}`}>
                  remove
                </button>
              )}
            </li>
          ))}
        </ul>

        {isHost && (
          <div className="mt-4 pt-4 border-t border-gray-800 text-left">
            <div className="text-xs uppercase tracking-wider text-arcade-300/70 mb-1.5">Add a bot</div>
            <div className="flex items-center gap-2">
              <div className="flex gap-1">
                {BOT_LEVELS.map((d) => (
                  <button
                    key={d.id}
                    onClick={() => setBotDiff(d.id)}
                    className={`px-2 py-1 rounded-md text-xs border ${botDiff === d.id ? "bg-arcade-400 text-gray-950 font-semibold border-arcade-300 shadow-[0_0_10px_rgba(34,211,238,0.45)]" : "bg-gray-800 border-gray-700 hover:border-arcade-400"}`}
                  >
                    {d.name}
                  </button>
                ))}
              </div>
              <button
                onClick={doAddBot}
                disabled={seated.length >= 4}
                className="ml-auto px-3 py-1 rounded-md text-sm bg-gray-800 border border-gray-700 hover:border-arcade-400 disabled:opacity-40"
              >
                + Bot
              </button>
            </div>
          </div>
        )}

        {error && <p className="text-sm text-red-400 mt-3">{error}</p>}

        <div className="mt-5 flex items-center justify-center gap-2">
          {amSeated ? (
            <Button variant="secondary" onClick={leave}>Leave seat</Button>
          ) : (
            <Button variant="arcade" onClick={doJoin} disabled={seated.length >= 4}>Take a seat</Button>
          )}
          {isHost && <Button variant="arcade" onClick={doStart} disabled={seated.length < 2}>Start game</Button>}
        </div>
        {!isHost && <p className="text-xs text-gray-600 mt-3">Waiting for the host to start…</p>}
      </div>
    );
  }

  // ── Playing / ended ──
  const turnName = state.seats[state.turn]?.name;
  const spectating = state.status === "playing" && !myColor;
  return (
    <div className="relative max-w-5xl mx-auto space-y-3">
      {/* Dice animations (sticker reactions live in the shared system now). */}
      <style>{`
        @keyframes ludo-spin { 0% { transform: rotate(0) scale(1) } 40% { transform: rotate(200deg) scale(1.15) } 100% { transform: rotate(360deg) scale(1) } }
        .ludo-dice-spin { animation: ludo-spin .6s ease-out; }
        @keyframes ludo-glow { 0%,100% { filter: drop-shadow(0 0 4px rgba(34,211,238,.55)) } 50% { filter: drop-shadow(0 0 14px rgba(34,211,238,.95)) } }
        .ludo-dice-glow { animation: ludo-glow 1.4s ease-in-out infinite; }
      `}</style>

      {spectating && (
        <div className="bg-amber-500/10 border border-amber-500/40 text-amber-300 rounded-xl px-4 py-2 text-sm text-center">
          👀 Game in progress — you&apos;re spectating. A seat opens when it ends!
        </div>
      )}

      <div className="flex flex-col md:flex-row gap-4 items-start">
        {/* ── Left rail: dice, timer, turn, notices, reactions, chat ── */}
        <div className="w-full md:w-48 shrink-0 flex flex-row md:flex-col items-center gap-4 order-2 md:order-1">
          <div className="flex flex-col items-center gap-2 pt-1">
            <Dice
              value={state.dice}
              canRoll={!state.winner && isMyTurn && !state.rolled}
              onRoll={roll}
              turnColor={state.turn}
            />
            <div className="h-3" />
            <TurnTimer deadline={state.turnDeadline} />
            <div className="text-sm text-center min-h-[2.2rem]">
              {state.winner ? (
                <span className="font-semibold text-arcade-300 flex items-center gap-1.5 justify-center">
                  <Dot color={state.winner} /> {state.seats[state.winner]?.name} wins! 🎉
                </span>
              ) : isMyTurn ? (
                <span className="font-semibold text-green-400">
                  {state.rolled && state.movable?.length > 0 ? "Pick a token!" : "Your turn"}
                </span>
              ) : (
                <span className="text-gray-300 flex items-center gap-1.5 justify-center">
                  <Dot color={state.turn} /> {turnName}&apos;s turn
                </span>
              )}
            </div>
            {state.winner && isHost && <Button variant="arcade" onClick={reset}>Play again</Button>}
          </div>

          <div className="flex-1 w-full space-y-3">
            {/* Animated sticker reactions */}
            <ReactionBar send={rx.send} />

            {notices.length > 0 && (
              <div className="space-y-1">
                {notices.slice(-3).map((n) => (
                  <p key={n.id} className="text-[11px] text-amber-300/90 leading-snug">{n.text}</p>
                ))}
              </div>
            )}

            <div className="hidden md:block">
              <GameChat roomId={roomId} />
            </div>
          </div>
        </div>

        {/* ── Board ── */}
        <div className="relative flex-1 order-1 md:order-2 w-full">
          <LudoBoard state={state} myColor={myColor} isMyTurn={isMyTurn} onMove={move} />

          {/* Floating animated stickers — big, visible to everyone. */}
          <ReactionOverlay floats={rx.floats} />
        </div>
      </div>

      <div className="md:hidden">
        <GameChat roomId={roomId} />
      </div>

      <div className="flex flex-wrap items-center justify-center gap-4 text-sm">
        {seated.map((c) => (
          <span key={c} className={`flex items-center gap-1 ${state.turn === c && !state.winner ? "text-white" : "text-gray-400"}`}>
            <Dot color={c} /> {state.seats[c].name}
            <span className="text-gray-500">· {homeCount(c)}/4 home</span>
          </span>
        ))}
      </div>
    </div>
  );
}
