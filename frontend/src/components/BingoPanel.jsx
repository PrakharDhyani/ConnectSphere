/**
 * Bingo — the hall UI. Each drawn ball drops in with a pop animation, your
 * card daubs with a stamp effect, the 75-number board lights up as numbers
 * are called, and the BINGO button is big, red and judgemental (the server
 * verifies every claim — false calls get shamed in the notice feed).
 */
import { useEffect, useRef, useState } from "react";
import { useLobbyGame } from "@/hooks/useLobbyGame.js";
import GameLobby, { SpectateBanner, NoticeFeed } from "@/components/GameLobby.jsx";
import Button from "@/components/ui/Button.jsx";
import { sfx } from "@/lib/sfx.js";

const LETTERS = ["B", "I", "N", "G", "O"];
const BALL_COLORS = ["#ef4444", "#eab308", "#22c55e", "#3b82f6", "#a855f7"];

function Ball({ n, size = 56, pop }) {
  const letter = LETTERS[Math.floor((n - 1) / 15)];
  const color = BALL_COLORS[Math.floor((n - 1) / 15)];
  return (
    <div
      className="rounded-full flex flex-col items-center justify-center font-black text-white shrink-0"
      style={{
        width: size, height: size,
        background: `radial-gradient(circle at 32% 28%, #ffffffcc, ${color} 55%, #00000055)`,
        boxShadow: "0 4px 10px rgba(0,0,0,0.5), inset 0 2px 4px rgba(255,255,255,0.5)",
        animation: pop ? "bingo-pop 0.5s cubic-bezier(0.34,1.56,0.64,1)" : "none",
      }}
    >
      <span style={{ fontSize: size * 0.28 }}>{letter}</span>
      <span style={{ fontSize: size * 0.36 }}>{n}</span>
    </div>
  );
}

export default function BingoPanel({ roomId }) {
  const lobby = useLobbyGame("bingo", roomId, {
    ball: ({ n }) => {
      setLastBall({ n, at: Date.now() });
      sfx.play("ballPop");
    },
  });
  const { me, state, priv, notices, isHost, act, reset } = lobby;
  const [lastBall, setLastBall] = useState(null);
  const [err, setErr] = useState(null);

  const mySeat = Boolean(state?.players?.some((p) => p.id === me?.id));
  const card = priv?.card;
  const daubs = priv?.daubs;
  const drawnSet = new Set(state?.drawn || []);
  const over = state?.status === "ended";

  const prevRef = useRef(null);
  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = state;
    if (prev && !prev.winnerId && state?.winnerId) {
      sfx.play(state.winnerId === me?.id ? "win" : "lose");
    }
  }, [state, me]);
  useEffect(() => {
    const last = notices[notices.length - 1];
    if (last?.text.includes("false BINGO")) sfx.play("falseCall");
  }, [notices]);

  if (!state || state.status === "lobby") {
    return (
      <GameLobby
        title="BINGO" emoji="🎱" tagline="A ball every few seconds — daub your card and shout BINGO first!"
        minPlayers={1} maxPlayers={10} lobby={lobby}
      />
    );
  }

  const doDaub = async (n) => {
    setErr(null);
    if (!drawnSet.has(n)) { setErr(`${n} hasn't been called yet!`); sfx.play("falseCall"); return; }
    sfx.play("daub");
    const res = await act("daub", { n });
    if (res?.error) setErr(res.error);
  };
  const doBingo = async () => {
    setErr(null);
    const res = await act("bingo");
    if (res?.error) setErr(res.error);
  };
  const nameOf = (id) => state.players?.find((p) => p.id === id)?.name;

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <style>{`
        @keyframes bingo-pop { 0% { transform: translateY(-70px) scale(0.3); opacity: 0 } 60% { transform: translateY(6px) scale(1.12) } 100% { transform: translateY(0) scale(1) } }
        @keyframes bingo-stamp { 0% { transform: scale(2.2); opacity: 0 } 60% { transform: scale(0.9); opacity: 1 } 100% { transform: scale(1) } }
      `}</style>

      {state.status === "playing" && !mySeat && <SpectateBanner />}

      <div className="flex flex-col lg:flex-row gap-4 items-start justify-center">
        {/* Left: caller machine + history + players */}
        <div className="w-full lg:w-64 space-y-3">
          <div className="bg-gray-900/70 border border-arcade-500/25 rounded-2xl p-4 flex flex-col items-center">
            <p className="text-xs uppercase tracking-wider text-arcade-300/70 mb-2">Now calling</p>
            {lastBall ? (
              <Ball key={lastBall.n} n={lastBall.n} size={84} pop />
            ) : (
              <div className="w-[84px] h-[84px] rounded-full border-2 border-dashed border-gray-700 flex items-center justify-center text-gray-600">…</div>
            )}
            <p className="text-[11px] text-gray-500 mt-2">{state.remaining} balls left</p>
            {/* recent history */}
            <div className="flex gap-1.5 mt-3">
              {(state.drawn || []).slice(-5, -1).reverse().map((n) => <Ball key={n} n={n} size={30} />)}
            </div>
          </div>

          <div className="bg-gray-900/70 border border-gray-800 rounded-2xl p-3">
            <p className="text-xs uppercase tracking-wider text-arcade-300/70 mb-2">Players</p>
            {state.players?.map((p) => (
              <div key={p.id} className="flex justify-between text-sm py-0.5">
                <span className={p.id === me?.id ? "text-arcade-300" : "text-gray-300"}>
                  {p.name}{p.isBot && " 🤖"}
                </span>
                <span className="text-gray-500">{state.daubCounts?.[p.id] ?? 0}/25</span>
              </div>
            ))}
          </div>
        </div>

        {/* Center: your card */}
        {card && (
          <div className="bg-gradient-to-b from-arcade-950/60 to-gray-900 border border-arcade-500/30 rounded-2xl p-4 shadow-2xl">
            <div className="grid grid-cols-5 gap-1.5 mb-1.5">
              {LETTERS.map((l, i) => (
                <div key={l} className="text-center font-black text-xl" style={{ color: BALL_COLORS[i] }}>{l}</div>
              ))}
            </div>
            <div className="grid grid-cols-5 gap-1.5">
              {[0, 1, 2, 3, 4].map((row) =>
                [0, 1, 2, 3, 4].map((col) => {
                  const n = card[col][row];
                  const daubed = daubs?.[col]?.[row];
                  const free = n === 0;
                  const callable = !free && drawnSet.has(n) && !daubed;
                  return (
                    <button
                      key={`${col}-${row}`}
                      onClick={() => !free && !daubed && doDaub(n)}
                      disabled={free || daubed || over}
                      className={`relative w-12 h-12 sm:w-14 sm:h-14 rounded-lg font-bold text-lg flex items-center justify-center transition-all
                        ${free ? "bg-arcade-900 text-arcade-300" : daubed ? "bg-gray-800 text-gray-500" : "bg-gray-100 text-gray-900 hover:scale-105"}
                        ${callable ? "ring-2 ring-arcade-400 animate-pulse" : ""}`}
                    >
                      {free ? "★" : n}
                      {daubed && !free && (
                        <span className="absolute inset-0 m-auto w-9 h-9 rounded-full bg-arcade-500/80 flex items-center justify-center text-gray-950"
                          style={{ animation: "bingo-stamp 0.3s" }}>
                          {n}
                        </span>
                      )}
                    </button>
                  );
                })
              )}
            </div>

            {mySeat && !over && (
              <button
                onClick={doBingo}
                className="mt-4 w-full py-3 rounded-xl font-black text-2xl tracking-widest text-white
                  bg-gradient-to-b from-red-500 to-red-700 hover:from-red-400 hover:to-red-600
                  shadow-[0_0_18px_rgba(239,68,68,0.5)] active:scale-95 transition-transform"
              >
                B I N G O !
              </button>
            )}
          </div>
        )}

        {/* Right: called board 1-75 */}
        <div className="w-full lg:w-56 bg-gray-900/70 border border-gray-800 rounded-2xl p-3">
          <p className="text-xs uppercase tracking-wider text-arcade-300/70 mb-2">Called board</p>
          <div className="grid grid-cols-5 gap-x-2">
            {[0, 1, 2, 3, 4].map((col) => (
              <div key={col} className="space-y-0.5">
                <div className="text-center text-xs font-black" style={{ color: BALL_COLORS[col] }}>{LETTERS[col]}</div>
                {Array.from({ length: 15 }, (_, i) => col * 15 + i + 1).map((n) => (
                  <div key={n}
                    className={`text-center text-[10px] rounded transition-colors ${
                      drawnSet.has(n) ? "text-gray-950 font-bold" : "text-gray-600"
                    }`}
                    style={drawnSet.has(n) ? { background: BALL_COLORS[col] } : {}}>
                    {n}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      <NoticeFeed notices={notices} />
      {err && <p className="text-center text-sm text-red-400">{err}</p>}

      {over && (
        <div className="text-center space-y-2">
          {state.winnerId ? (
            <p className="text-2xl font-black text-arcade-300"
              style={{ textShadow: "0 0 18px rgba(34,211,238,0.6)" }}>
              🎉 B·I·N·G·O — {nameOf(state.winnerId)} wins!
            </p>
          ) : (
            <p className="text-lg text-gray-400">📭 Nobody hit bingo — the house wins.</p>
          )}
          {isHost && <Button variant="arcade" onClick={reset}>Play again</Button>}
        </div>
      )}
    </div>
  );
}
