/**
 * Chess puzzles — solo mode. Puzzles are GENERATED on the fly (see
 * lib/chessPuzzles.js) and verified before they're shown, so every one has a
 * proven forced mate. You always play White; wrong tries bounce back; the
 * defense replies automatically; streak persists per day in localStorage.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Chess } from "chess.js";
import { ChessBoard } from "@/components/ChessPanel.jsx";
import Button from "@/components/ui/Button.jsx";
import { generatePuzzleAsync, dailyPuzzleAsync, defenseCannotEscape, dailySeed } from "@/lib/chessPuzzles.js";
import { sfx } from "@/lib/sfx.js";

const STREAK_KEY = "groot:puzzleStreak";
const loadStreak = () => {
  try {
    const s = JSON.parse(localStorage.getItem(STREAK_KEY));
    return s?.day === dailySeed() ? s.count : 0;
  } catch { return 0; }
};

export default function PuzzlePanel() {
  const [puzzle, setPuzzle] = useState(null); // { fen, mateIn, kind }
  const [chess, setChess] = useState(null);
  const [remaining, setRemaining] = useState(0); // white mating moves left
  const [selected, setSelected] = useState(null);
  const [phase, setPhase] = useState("idle"); // idle | generating | solving | wrong | solved
  const [streak, setStreak] = useState(loadStreak);
  const replyTimer = useRef(null);

  useEffect(() => () => clearTimeout(replyTimer.current), []);

  const bumpStreak = () => {
    const next = streak + 1;
    setStreak(next);
    try { localStorage.setItem(STREAK_KEY, JSON.stringify({ day: dailySeed(), count: next })); } catch { /* ok */ }
  };

  const load = useCallback(async (kind, difficulty) => {
    setPhase("generating");
    setPuzzle(null);
    setSelected(null);
    // Generation is chunked/async — the UI keeps animating while we search.
    const p = kind === "daily" ? await dailyPuzzleAsync() : await generatePuzzleAsync(difficulty);
    if (!p) { setPhase("idle"); return; }
    setPuzzle({ ...p, kind: kind === "daily" ? "Daily" : difficulty });
    setChess(new Chess(p.fen));
    setRemaining(p.mateIn);
    setPhase("solving");
  }, []);

  const clickSquare = (sq) => {
    if (phase !== "solving" || !chess || chess.turn() !== "w") return;
    const piece = chess.get(sq);
    const legal = selected ? chess.moves({ square: selected, verbose: true }).some((m) => m.to === sq) : false;

    if (selected && legal) {
      const next = new Chess(chess.fen());
      next.move({ from: selected, to: sq, promotion: "q" });
      setSelected(null);

      if (defenseCannotEscape(next, remaining)) {
        // Correct — either mate now, or the net is still closing.
        sfx.play(next.isCheckmate() ? "chessCapture" : "chessMove");
        setChess(next);
        if (next.isCheckmate()) {
          sfx.play("win");
          setPhase("solved");
          bumpStreak();
          return;
        }
        if (next.inCheck()) sfx.play("check");
        // Defense replies (any reply loses — that's proven), then it's on you.
        replyTimer.current = setTimeout(() => {
          const replies = next.moves();
          const reply = replies[Math.floor(Math.random() * replies.length)];
          const after = new Chess(next.fen());
          after.move(reply);
          sfx.play("chessMove");
          setChess(after);
          setRemaining((r) => r - 1);
        }, 450);
      } else {
        // Legal but lets the king slip — bounce it back.
        sfx.play("keyError");
        setPhase("wrong");
        setTimeout(() => setPhase("solving"), 700);
      }
      return;
    }
    setSelected(piece && piece.color === "w" ? sq : null);
  };

  const legalTargets = new Set(
    selected && chess ? chess.moves({ square: selected, verbose: true }).map((m) => m.to) : []
  );

  return (
    <div className="max-w-lg mx-auto space-y-3">
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button variant="arcade" onClick={() => load("daily")}>🌞 Daily puzzle</Button>
        {["easy", "medium", "hard"].map((d) => (
          <button
            key={d}
            onClick={() => load("fresh", d)}
            className="px-3 py-1.5 rounded-lg text-sm capitalize bg-gray-800 border border-gray-700 hover:border-arcade-400"
          >
            {d}
          </button>
        ))}
        <span className="text-sm text-amber-300 font-semibold ml-2">🔥 {streak} today</span>
      </div>

      {phase === "idle" && !puzzle && (
        <p className="text-center text-gray-500 text-sm py-8">
          Every puzzle is generated fresh and machine-verified to have a forced mate.<br />
          Pick the daily challenge or a difficulty to start.
        </p>
      )}
      {phase === "generating" && (
        <p className="text-center text-arcade-300 text-sm py-8 animate-pulse">⚙️ forging a puzzle…</p>
      )}

      {puzzle && chess && phase !== "generating" && (
        <>
          <div className="flex items-center justify-between bg-gray-900/80 border border-arcade-500/20 rounded-xl px-4 py-2 text-sm">
            <span className="capitalize text-gray-400">{puzzle.kind} puzzle</span>
            {phase === "solved" ? (
              <span className="font-bold text-arcade-300">✨ Solved!</span>
            ) : phase === "wrong" ? (
              <span className="font-bold text-red-400">Not that — try again</span>
            ) : (
              <span className="font-semibold text-amber-300">
                White to move — mate in {remaining}
              </span>
            )}
          </div>

          <div style={phase === "wrong" ? { animation: "typing-shake 0.2s" } : undefined}>
            <style>{`@keyframes typing-shake { 25% { transform: translateX(-4px) } 75% { transform: translateX(4px) } }`}</style>
            <ChessBoard
              chess={chess}
              flipped={false}
              selected={selected}
              legalTargets={legalTargets}
              lastMove={null}
              onSquare={clickSquare}
            />
          </div>

          {phase === "solved" && (
            <div className="text-center space-y-2">
              <p className="text-2xl font-black text-arcade-300" style={{ textShadow: "0 0 16px rgba(34,211,238,0.6)" }}>
                ♛ Checkmate!
              </p>
              <Button variant="arcade" onClick={() => load("fresh", puzzle.kind === "Daily" ? "medium" : puzzle.kind)}>
                Next puzzle →
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
