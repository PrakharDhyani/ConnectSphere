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

function Ball({ n, size = 56, pop, plain = false }) {
  // Classic 75-ball shows its B/I/N/G/O letter; turn-pick (1–25) is plain.
  const letter = plain ? null : LETTERS[Math.floor((n - 1) / 15)];
  const color = BALL_COLORS[plain ? (n - 1) % 5 : Math.floor((n - 1) / 15)];
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
      {letter && <span style={{ fontSize: size * 0.28 }}>{letter}</span>}
      <span style={{ fontSize: size * (letter ? 0.36 : 0.46) }}>{n}</span>
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
  const nameOf = (id) => state?.players?.find((p) => p.id === id)?.name;

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
    const isHost = lobby.isHost;
    const mode = state?.bingoMode || "classic";
    const modes = [
      { id: "classic", label: "🎱 Classic 75", desc: "auto-caller, first valid line wins" },
      { id: "turns", label: "🤝 Turn pick", desc: "YOU call the numbers, 5 lines win" },
    ];
    return (
      <GameLobby
        title="BINGO" emoji="🎱" tagline="Two ways to play — pick a mode below."
        minPlayers={1} maxPlayers={10} lobby={lobby}
      >
        <div className="mt-4 pt-4 border-t border-gray-800 text-left">
          <p className="text-xs uppercase tracking-wider text-arcade-300/70 mb-1.5">
            Mode {!isHost && <span className="text-gray-600 normal-case">(host picks)</span>}
          </p>
          <div className="grid grid-cols-2 gap-2 mb-3">
            {modes.map((m) => (
              <button
                key={m.id}
                disabled={!isHost}
                onClick={() => act("setMode", { mode: m.id })}
                className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                  mode === m.id
                    ? "border-arcade-300 bg-arcade-400/20 shadow-[0_0_10px_rgba(34,211,238,0.3)]"
                    : "border-gray-700 bg-gray-800"
                } ${isHost ? "hover:border-arcade-400" : "opacity-75 cursor-default"}`}
              >
                <span className="block text-sm font-semibold">{m.label}</span>
                <span className="block text-[11px] text-gray-500 leading-snug">{m.desc}</span>
              </button>
            ))}
          </div>
          {/* Rules for the selected mode */}
          <div className="bg-gray-900/70 border border-gray-800 rounded-lg p-3 text-[12px] text-gray-400 leading-relaxed">
            {mode === "classic" ? (
              <>
                <b className="text-gray-200">How to play — Classic 75:</b> everyone gets a random
                5×5 card (B1–15 · I16–30 · N31–45 · G46–60 · O61–75, free ★ center). A ball is
                called every few seconds — <b>tap the number on your card to daub it</b> (miss it
                and it stays uncalled for you!). First to complete <b>any full row, column or
                diagonal</b> hits the big red button. False BINGOs get publicly shamed. 🔕
              </>
            ) : (
              <>
                <b className="text-gray-200">How to play — Turn pick:</b> everyone gets the numbers
                <b> 1–25</b> arranged randomly on their own 5×5 card. Players take turns
                <b> calling any number</b> — it&apos;s marked on <i>everyone&apos;s</i> card automatically,
                so it&apos;s all about whose <i>arrangement</i> lines up first. Complete{" "}
                <b>5 lines</b> (rows, columns or diagonals — crossing lines can share numbers)
                and you win on the spot. Call numbers that help YOUR card! 🧠
              </>
            )}
          </div>
        </div>
      </GameLobby>
    );
  }

  // ── Turn-pick view ─────────────────────────────────────────────────────────
  if (state.bingoMode === "turns") {
    const calledSet = new Set(state.called || []);
    const myTurn = state.pickerId === me?.id && !over;
    const myLines = state.lineCounts?.[me?.id] ?? 0;
    const pickerName = state.players?.find((p) => p.id === state.pickerId)?.name;
    const doPick = async (n) => {
      setErr(null);
      sfx.play("daub");
      const res = await act("pick", { n });
      if (res?.error) setErr(res.error);
    };
    return (
      <div className="max-w-3xl mx-auto space-y-4">
        <style>{`@keyframes bingo-stamp { 0% { transform: scale(2.2); opacity: 0 } 60% { transform: scale(0.9); opacity: 1 } 100% { transform: scale(1) } }`}</style>
        {state.status === "playing" && !mySeat && <SpectateBanner />}

        {/* Status bar */}
        <div className="flex items-center justify-between bg-gray-900/80 border border-arcade-500/20 rounded-xl px-4 py-2 text-sm">
          <span className="flex items-center gap-2">
            {lastBall && <Ball key={lastBall.n} n={lastBall.n} size={34} plain pop />}
            <span className="text-gray-400">{(state.called || []).length}/25 called</span>
          </span>
          {over ? (
            <span className="font-bold text-amber-300">game over</span>
          ) : myTurn ? (
            <span className="font-bold text-arcade-300 animate-pulse">Your turn — call a number!</span>
          ) : (
            <span className="text-gray-400">{pickerName} is calling…</span>
          )}
          <span className="text-amber-300 font-bold">{myLines}/{state.linesToWin || 5} lines</span>
        </div>

        <div className="flex flex-col lg:flex-row gap-4 items-start justify-center">
          {/* Calling board 1–25 */}
          <div className="bg-gray-900/70 border border-arcade-500/25 rounded-2xl p-4">
            <p className="text-xs uppercase tracking-wider text-arcade-300/70 mb-2 text-center">
              {myTurn ? "tap to call" : "calling board"}
            </p>
            <div className="grid grid-cols-5 gap-1.5">
              {Array.from({ length: 25 }, (_, i) => i + 1).map((n) => {
                const called = calledSet.has(n);
                return (
                  <button
                    key={n}
                    disabled={!myTurn || called}
                    onClick={() => doPick(n)}
                    className={`w-11 h-11 sm:w-12 sm:h-12 rounded-lg font-bold text-base transition-all ${
                      called
                        ? "text-white/90 scale-95"
                        : myTurn
                          ? "bg-gray-100 text-gray-900 hover:scale-110 hover:shadow-[0_0_10px_rgba(34,211,238,0.6)]"
                          : "bg-gray-800 text-gray-500"
                    }`}
                    style={called ? { background: BALL_COLORS[(n - 1) % 5] } : {}}
                  >
                    {n}
                  </button>
                );
              })}
            </div>
          </div>

          {/* My card — daubs are automatic (every card holds 1–25) */}
          {card && (
            <div className="bg-gradient-to-b from-arcade-950/60 to-gray-900 border border-arcade-500/30 rounded-2xl p-4 shadow-2xl">
              <p className="text-xs uppercase tracking-wider text-arcade-300/70 mb-2 text-center">your card</p>
              <div className="grid grid-cols-5 gap-1.5">
                {[0, 1, 2, 3, 4].map((row) =>
                  [0, 1, 2, 3, 4].map((col) => {
                    const n = card[col][row];
                    const daubed = calledSet.has(n);
                    return (
                      <div
                        key={`${col}-${row}`}
                        className={`relative w-11 h-11 sm:w-12 sm:h-12 rounded-lg font-bold text-base flex items-center justify-center ${
                          daubed ? "bg-gray-800 text-gray-600" : "bg-gray-100 text-gray-900"
                        }`}
                      >
                        {n}
                        {daubed && (
                          <span
                            className="absolute inset-0 m-auto w-8 h-8 rounded-full bg-arcade-500/85 flex items-center justify-center text-gray-950"
                            style={{ animation: "bingo-stamp 0.3s" }}
                          >
                            {n}
                          </span>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
              {/* 5-line win meter */}
              <div className="flex justify-center gap-1.5 mt-3">
                {Array.from({ length: state.linesToWin || 5 }, (_, i) => (
                  <span
                    key={i}
                    className={`w-8 h-2 rounded-full ${i < myLines ? "bg-arcade-400 shadow-[0_0_8px_rgba(34,211,238,0.7)]" : "bg-gray-800"}`}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Line standings */}
          <div className="w-full lg:w-52 bg-gray-900/70 border border-gray-800 rounded-2xl p-3">
            <p className="text-xs uppercase tracking-wider text-arcade-300/70 mb-2">Lines</p>
            {state.players?.map((p) => (
              <div key={p.id} className={`flex justify-between text-sm py-0.5 ${state.pickerId === p.id && !over ? "text-arcade-300" : "text-gray-300"}`}>
                <span>{p.name}{p.isBot && " 🤖"}</span>
                <span className="font-bold text-amber-300">{state.lineCounts?.[p.id] ?? 0}/{state.linesToWin || 5}</span>
              </div>
            ))}
          </div>
        </div>

        <NoticeFeed notices={notices} />
        {err && <p className="text-center text-sm text-red-400">{err}</p>}
        {over && (
          <div className="text-center space-y-2">
            {state.winnerId && (
              <p className="text-2xl font-black text-arcade-300" style={{ textShadow: "0 0 18px rgba(34,211,238,0.6)" }}>
                🎉 B·I·N·G·O — {nameOf(state.winnerId)} wins with 5 lines!
              </p>
            )}
            {isHost && <Button variant="arcade" onClick={reset}>Play again</Button>}
          </div>
        )}
      </div>
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
