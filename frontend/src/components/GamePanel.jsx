/**
 * Draw-and-guess UI. A ready-up lobby (join → ready → host starts when everyone
 * is ready and there are 2+), then the timed drawing rounds. Responsive: stacks
 * on mobile, two columns on desktop.
 */
import { useEffect, useRef, useState } from "react";
import { useSkribbl } from "@/hooks/useSkribbl.js";
import GameCanvas from "@/components/GameCanvas.jsx";
import Button from "@/components/ui/Button.jsx";
import Input from "@/components/ui/Input.jsx";

export default function GamePanel({ roomId }) {
  const { state, choices, myWord, feed, isDrawer, iGuessed, me, spectating, start, setReady, chooseWord, guess } =
    useSkribbl(roomId);
  const [rounds, setRounds] = useState(3);
  const [draft, setDraft] = useState("");
  const [startError, setStartError] = useState(null);
  const [remaining, setRemaining] = useState(0);
  const feedRef = useRef(null);

  useEffect(() => {
    if (state?.status !== "drawing" || !state.turnEndsAt) return setRemaining(0);
    const tick = () => setRemaining(Math.max(0, Math.ceil((state.turnEndsAt - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 400);
    return () => clearInterval(id);
  }, [state?.status, state?.turnEndsAt]);

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight });
  }, [feed]);

  async function handleStart() {
    setStartError(null);
    const res = await start(rounds);
    if (res?.error) setStartError(res.error);
  }
  function submitGuess(e) {
    e.preventDefault();
    const t = draft.trim();
    if (!t) return;
    guess(t);
    setDraft("");
  }

  const status = state?.status || "lobby";
  const lobby = state?.lobby || [];
  const players = state?.players || [];
  const guessedSet = new Set(state?.guessed || []);
  const canGuess = status === "drawing" && !isDrawer && !iGuessed;

  const isHost = state?.hostId === me?.id;
  const allReady = lobby.length >= 2 && lobby.every((p) => p.ready);
  const inLobby = status === "lobby" || status === "ended";

  if (spectating && !inLobby) {
    // Mid-round arrivals watch the drawing live but can't guess or score;
    // the hook auto-claims a seat the moment the round finishes.
    return (
      <div className="space-y-3">
        <div className="bg-amber-500/10 border border-amber-500/40 text-amber-300 rounded-xl px-4 py-2 text-sm text-center">
          👀 Round in progress — you&apos;re spectating and will join automatically when it ends.
        </div>
        <GameCanvas roomId={roomId} isDrawer={false} />
      </div>
    );
  }

  return (
    <div className="grid lg:grid-cols-[1fr_280px] gap-4">
      <div className="space-y-3">
        {/* header */}
        <div className="flex items-center justify-between gap-3 bg-gray-900 border border-gray-800 rounded-xl px-4 py-2">
          <div className="text-sm">
            {inLobby && <span className="text-gray-400">Draw &amp; Guess — lobby</span>}
            {status === "choosing" &&
              (isDrawer ? (
                <span className="text-arcade-300">Pick a word to draw</span>
              ) : (
                <span className="text-gray-400"><b className="text-gray-200">{state.drawerName}</b> is choosing…</span>
              ))}
            {status === "drawing" && (
              <span className="font-mono tracking-[0.3em] text-lg">{isDrawer ? myWord : state.masked}</span>
            )}
            {status === "reveal" && (
              <span className="text-gray-300">The word was <b className="text-arcade-300">{state.word}</b></span>
            )}
          </div>
          <div className="flex items-center gap-3 text-sm text-gray-400 shrink-0">
            {!inLobby && <span>Round {Math.min(state.round, state.maxRounds)}/{state.maxRounds}</span>}
            {status === "drawing" && (
              <span className={`font-bold ${remaining <= 10 ? "text-red-400" : "text-gray-200"}`}>⏱ {remaining}s</span>
            )}
          </div>
        </div>

        {status === "choosing" && isDrawer && choices && (
          <div className="flex flex-wrap gap-2">
            {choices.map((w) => <Button variant="arcade" key={w} onClick={() => chooseWord(w)}>{w}</Button>)}
          </div>
        )}

        {inLobby ? (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 text-center">
            <p className="text-4xl mb-2">🎨</p>
            <h2 className="text-lg font-semibold">{status === "ended" ? "Game over 🎉" : "Draw & Guess"}</h2>

            {status === "ended" && players.length > 0 && (
              <ol className="mt-3 max-w-xs mx-auto space-y-1 text-sm">
                {players.map((p, i) => (
                  <li key={p.id} className="flex justify-between">
                    <span>{i === 0 ? "🏆 " : `${i + 1}. `}{p.name}</span>
                    <span className="text-arcade-300 font-semibold">{p.score}</span>
                  </li>
                ))}
              </ol>
            )}

            <div className="mt-4 max-w-xs mx-auto text-left">
              <p className="text-xs uppercase tracking-wide text-gray-500 mb-2">Players ({lobby.length})</p>
              <ul className="space-y-1">
                {lobby.map((p) => (
                  <li key={p.id} className="flex items-center justify-between text-sm">
                    <span className={p.id === me?.id ? "text-arcade-300" : "text-gray-300"}>
                      {p.name}{p.id === state.hostId ? " 👑" : ""}{p.id === me?.id ? " (you)" : ""}
                    </span>
                    {p.id === me?.id ? (
                      <button
                        type="button"
                        onClick={() => setReady(!p.ready)}
                        title="Tap to toggle ready"
                        className={`font-medium rounded px-2 py-0.5 transition-colors ${
                          p.ready
                            ? "text-green-400 hover:bg-green-950/40"
                            : "text-gray-400 hover:text-white hover:bg-gray-800"
                        }`}
                      >
                        {p.ready ? "Ready ✓" : "Tap to ready"}
                      </button>
                    ) : (
                      <span className={p.ready ? "text-green-400" : "text-gray-500"}>
                        {p.ready ? "Ready ✓" : "Not ready"}
                      </span>
                    )}
                  </li>
                ))}
                {lobby.length === 0 && <li className="text-xs text-gray-500">Waiting for players…</li>}
              </ul>
            </div>

            {startError && <p className="text-sm text-red-400 mt-3">{startError}</p>}

            <div className="mt-5 flex flex-col items-center gap-2">
              {isHost && (
                <div className="flex items-center gap-2">
                  <label className="text-sm text-gray-400">Rounds</label>
                  <select
                    value={rounds}
                    onChange={(e) => setRounds(Number(e.target.value))}
                    className="bg-gray-950 border border-gray-700 rounded px-2 py-1 text-sm"
                  >
                    {[1, 2, 3, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                  <Button variant="arcade" onClick={handleStart} disabled={!allReady}>{status === "ended" ? "Play again" : "Start"}</Button>
                </div>
              )}
              <p className="text-xs text-gray-600">
                {allReady
                  ? isHost
                    ? "Everyone's ready!"
                    : "Waiting for the host to start…"
                  : "Tap your status above to ready up. Need 2+ players, all ready."}
              </p>
            </div>
          </div>
        ) : (
          <GameCanvas roomId={roomId} isDrawer={isDrawer} />
        )}
      </div>

      {/* scores + feed + guess */}
      <aside className="flex flex-col gap-3">
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-3">
          <h3 className="text-sm font-semibold text-gray-300 mb-2">Scores</h3>
          <ul className="space-y-1">
            {(inLobby ? lobby : players).map((p) => (
              <li key={p.id} className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-1 truncate">
                  {state?.drawerId === p.id && <span title="Drawing">✏️</span>}
                  {guessedSet.has(p.id) && <span className="text-green-400" title="Guessed">✓</span>}
                  <span className={p.id === me?.id ? "text-arcade-300" : "text-gray-300"}>{p.name}</span>
                </span>
                <span className="text-gray-400 font-medium">{"score" in p ? p.score : ""}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-3 flex-1 min-h-[160px]">
          <div ref={feedRef} className="h-40 lg:h-48 overflow-y-auto space-y-1 text-sm pr-1">
            {feed.map((f, i) => (
              <p key={i} className="break-words">
                {f.type === "correct" && <span className="text-green-400">✓ {f.mine ? "You" : f.name} guessed the word!</span>}
                {f.type === "guess" && <span className="text-gray-300"><b className="text-gray-200">{f.name}:</b> {f.text}</span>}
                {f.type === "reveal" && <span className="text-gray-500 italic">— word was “{f.word}” —</span>}
              </p>
            ))}
            {feed.length === 0 && <p className="text-xs text-gray-500">Guesses appear here.</p>}
          </div>
          <form onSubmit={submitGuess} className="mt-2">
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={!canGuess}
              placeholder={
                isDrawer ? "You're drawing…" : iGuessed ? "You guessed it! 🎉" : status === "drawing" ? "Type your guess" : "Waiting…"
              }
            />
          </form>
        </div>
      </aside>
    </div>
  );
}
