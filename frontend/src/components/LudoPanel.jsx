import { useEffect, useRef, useState } from "react";
import { useLudo } from "@/hooks/useLudo.js";
import LudoBoard from "@/components/LudoBoard.jsx";
import Button from "@/components/ui/Button.jsx";
import { COLORS, COLOR_HEX } from "@/games/ludoBoard.js";
import { sfx } from "@/lib/sfx.js";

const Dot = ({ color, size = 12 }) => (
  <span style={{ background: COLOR_HEX[color], width: size, height: size }} className="inline-block rounded-full" />
);

const BOT_LEVELS = [
  { id: "easy", name: "Easy" },
  { id: "medium", name: "Medium" },
  { id: "hard", name: "Hard" },
];

export default function LudoPanel({ roomId }) {
  const { state, me, myColor, isMyTurn, join, leave, start, roll, move, reset, addBot, removeBot } = useLudo(roomId);
  const [error, setError] = useState(null);
  const [botDiff, setBotDiff] = useState("medium");

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
      <div className="max-w-md mx-auto bg-gray-900 border border-gray-800 rounded-2xl p-6 text-center">
        <p className="text-4xl mb-2">🎲</p>
        <h2 className="text-lg font-semibold">Ludo</h2>
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
            <div className="text-xs uppercase text-gray-500 mb-1.5">Add a bot</div>
            <div className="flex items-center gap-2">
              <div className="flex gap-1">
                {BOT_LEVELS.map((d) => (
                  <button
                    key={d.id}
                    onClick={() => setBotDiff(d.id)}
                    className={`px-2 py-1 rounded-md text-xs border ${botDiff === d.id ? "bg-brand-600 border-brand-500" : "bg-gray-800 border-gray-700 hover:border-brand-500"}`}
                  >
                    {d.name}
                  </button>
                ))}
              </div>
              <button
                onClick={doAddBot}
                disabled={seated.length >= 4}
                className="ml-auto px-3 py-1 rounded-md text-sm bg-gray-800 border border-gray-700 hover:border-brand-500 disabled:opacity-40"
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
            <Button onClick={doJoin} disabled={seated.length >= 4}>Take a seat</Button>
          )}
          {isHost && <Button onClick={doStart} disabled={seated.length < 2}>Start game</Button>}
        </div>
        {!isHost && <p className="text-xs text-gray-600 mt-3">Waiting for the host to start…</p>}
      </div>
    );
  }

  // ── Playing / ended ──
  const turnName = state.seats[state.turn]?.name;
  return (
    <div className="max-w-3xl mx-auto space-y-3">
      <div className="flex items-center justify-between gap-3 bg-gray-900 border border-gray-800 rounded-xl px-4 py-2">
        <div className="flex items-center gap-2 text-sm">
          {state.winner ? (
            <span className="font-semibold text-brand-300 flex items-center gap-2">
              <Dot color={state.winner} /> {state.seats[state.winner]?.name} wins! 🎉
            </span>
          ) : isMyTurn ? (
            <span className="font-semibold text-green-400">Your turn</span>
          ) : (
            <span className="text-gray-300 flex items-center gap-2">
              <Dot color={state.turn} /> {turnName}&apos;s turn
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {state.dice && (
            <span className="w-8 h-8 rounded-lg bg-white text-gray-900 font-bold flex items-center justify-center">
              {state.dice}
            </span>
          )}
          {!state.winner && isMyTurn && !state.rolled && <Button onClick={roll}>🎲 Roll</Button>}
          {!state.winner && isMyTurn && state.rolled && state.movable?.length > 0 && (
            <span className="text-xs text-brand-300">Pick a token</span>
          )}
          {state.winner && isHost && <Button onClick={reset}>Play again</Button>}
        </div>
      </div>

      <LudoBoard state={state} myColor={myColor} isMyTurn={isMyTurn} onMove={move} />

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
