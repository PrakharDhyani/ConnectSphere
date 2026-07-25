/**
 * Draw-and-guess game UI. Composes the game state (useSkribbl) with the shared
 * canvas. Responsive: stacks on mobile (canvas → scores → guess), two columns
 * on desktop.
 */
import { useEffect, useRef, useState } from "react";
import { useSkribbl } from "@/hooks/useSkribbl.js";
import GameCanvas from "@/components/GameCanvas.jsx";
import Button from "@/components/ui/Button.jsx";
import Input from "@/components/ui/Input.jsx";

export default function GamePanel({ roomId }) {
  const { state, choices, myWord, feed, isDrawer, iGuessed, me, start, chooseWord, guess } =
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

  const status = state?.status || "idle";
  const players = state?.players || [];
  const guessedSet = new Set(state?.guessed || []);
  const canGuess = status === "drawing" && !isDrawer && !iGuessed;

  return (
    <div className="grid lg:grid-cols-[1fr_280px] gap-4">
      {/* Left: header + canvas */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3 bg-gray-900 border border-gray-800 rounded-xl px-4 py-2">
          <div className="text-sm">
            {status === "idle" && <span className="text-gray-400">Ready to play</span>}
            {status === "choosing" &&
              (isDrawer ? (
                <span className="text-brand-300">Pick a word to draw</span>
              ) : (
                <span className="text-gray-400">
                  <b className="text-gray-200">{state.drawerName}</b> is choosing a word…
                </span>
              ))}
            {status === "drawing" && (
              <span className="font-mono tracking-[0.3em] text-lg">
                {isDrawer ? myWord : state.masked}
              </span>
            )}
            {status === "reveal" && (
              <span className="text-gray-300">
                The word was <b className="text-brand-300">{state.word}</b>
              </span>
            )}
            {status === "ended" && <span className="text-brand-300 font-semibold">Game over 🎉</span>}
          </div>
          <div className="flex items-center gap-3 text-sm text-gray-400 shrink-0">
            {status !== "idle" && <span>Round {Math.min(state.round, state.maxRounds)}/{state.maxRounds}</span>}
            {status === "drawing" && (
              <span className={`font-bold ${remaining <= 10 ? "text-red-400" : "text-gray-200"}`}>⏱ {remaining}s</span>
            )}
          </div>
        </div>

        {/* Word choices (drawer, choosing) */}
        {status === "choosing" && isDrawer && choices && (
          <div className="flex flex-wrap gap-2">
            {choices.map((w) => (
              <Button key={w} onClick={() => chooseWord(w)}>{w}</Button>
            ))}
          </div>
        )}

        {/* Canvas or start/end screens */}
        {status === "idle" || status === "ended" ? (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 text-center">
            <p className="text-4xl mb-3">🎨</p>
            <h2 className="text-lg font-semibold">
              {status === "ended" ? "Final scores" : "Draw & Guess"}
            </h2>
            {status === "ended" ? (
              <ol className="mt-4 max-w-xs mx-auto space-y-1 text-sm">
                {players.map((p, i) => (
                  <li key={p.id} className="flex justify-between">
                    <span>{i === 0 ? "🏆 " : `${i + 1}. `}{p.name}</span>
                    <span className="text-brand-300 font-semibold">{p.score}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-gray-500 text-sm mt-2">
                One player draws a secret word, everyone else races to guess it. Needs 2+ people in the room.
              </p>
            )}
            <div className="mt-5 flex items-center justify-center gap-2">
              <label className="text-sm text-gray-400">Rounds</label>
              <select
                value={rounds}
                onChange={(e) => setRounds(Number(e.target.value))}
                className="bg-gray-950 border border-gray-700 rounded px-2 py-1 text-sm"
              >
                {[1, 2, 3, 5].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
              <Button onClick={handleStart}>{status === "ended" ? "Play again" : "Start game"}</Button>
            </div>
            {startError && <p className="text-sm text-red-400 mt-2">{startError}</p>}
          </div>
        ) : (
          <GameCanvas roomId={roomId} isDrawer={isDrawer} />
        )}
      </div>

      {/* Right: scores + feed + guess */}
      <aside className="flex flex-col gap-3">
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-3">
          <h3 className="text-sm font-semibold text-gray-300 mb-2">Players</h3>
          <ul className="space-y-1">
            {players.map((p) => (
              <li key={p.id} className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-1 truncate">
                  {state?.drawerId === p.id && <span title="Drawing">✏️</span>}
                  {guessedSet.has(p.id) && <span className="text-green-400" title="Guessed">✓</span>}
                  <span className={p.id === me?.id ? "text-brand-300" : "text-gray-300"}>{p.name}</span>
                </span>
                <span className="text-gray-400 font-medium">{p.score}</span>
              </li>
            ))}
            {players.length === 0 && <li className="text-xs text-gray-500">No players yet</li>}
          </ul>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-3 flex-1 min-h-[160px]">
          <div ref={feedRef} className="h-40 lg:h-48 overflow-y-auto space-y-1 text-sm pr-1">
            {feed.map((f, i) => (
              <p key={i} className="break-words">
                {f.type === "correct" && (
                  <span className="text-green-400">✓ {f.mine ? "You" : f.name} guessed the word!</span>
                )}
                {f.type === "guess" && (
                  <span className="text-gray-300"><b className="text-gray-200">{f.name}:</b> {f.text}</span>
                )}
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
