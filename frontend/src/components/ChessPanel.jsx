/**
 * Chess — animated board UI. Server (chess.js) is authoritative; a local
 * chess.js instance mirrors the FEN purely for UX: legal-move dots, promotion
 * detection, and instant feedback. Pieces are layered Unicode glyphs with
 * gradients and a soft drop — they slide between squares via CSS transitions
 * (same absolute-positioning trick as the Ludo pawns).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Chess } from "chess.js";
import { useLobbyGame } from "@/hooks/useLobbyGame.js";
import GameLobby, { SpectateBanner, NoticeFeed } from "@/components/GameLobby.jsx";
import { useReactions, ReactionBar, ReactionOverlay } from "@/components/Reactions.jsx";
import PuzzlePanel from "@/components/PuzzlePanel.jsx";
import Button from "@/components/ui/Button.jsx";
import { sfx } from "@/lib/sfx.js";

const GLYPH = {
  wk: "♔", wq: "♕", wr: "♖", wb: "♗", wn: "♘", wp: "♙",
  bk: "♚", bq: "♛", br: "♜", bb: "♝", bn: "♞", bp: "♟",
};
const FILES = "abcdefgh";
const RESULT_TEXT = {
  checkmate: "Checkmate!", stalemate: "Stalemate — draw", repetition: "Draw by repetition",
  material: "Draw — insufficient material", draw: "Draw", resignation: "Resignation", timeout: "Flag fell — time out!",
};
const TIME_CHOICES = [
  { m: 1, label: "1 min ⚡" }, { m: 3, label: "3 min" }, { m: 5, label: "5 min" },
  { m: 10, label: "10 min" }, { m: 15, label: "15 min" }, { m: 0, label: "No clock" },
];

const fmtClock = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** A player's clock — live-ticking for the side to move. */
function Clock({ baseMs, running, turnStartedAt, result }) {
  const [, force] = useState(0);
  useEffect(() => {
    if (!running || result) return;
    const t = setInterval(() => force((n) => n + 1), 200);
    return () => clearInterval(t);
  }, [running, result]);
  if (baseMs == null) return null;
  const ms = running && !result ? Math.max(0, baseMs - (Date.now() - turnStartedAt)) : baseMs;
  const low = ms < 30_000;
  return (
    <span
      className={`font-mono font-bold px-2 py-0.5 rounded-md text-sm tabular-nums ${
        running && !result
          ? low
            ? "bg-red-950/80 text-red-300 animate-pulse ring-1 ring-red-500"
            : "bg-arcade-950/80 text-arcade-300 ring-1 ring-arcade-500/50"
          : "bg-gray-800 text-gray-400"
      }`}
    >
      {fmtClock(ms)}
    </span>
  );
}

function Piece({ piece, x, y, size, mine, selected }) {
  return (
    <div
      className="absolute flex items-center justify-center pointer-events-none select-none"
      style={{
        width: size, height: size,
        left: x * size, top: y * size,
        transition: "left 0.22s ease, top 0.22s ease",
        zIndex: selected ? 20 : 10,
      }}
    >
      <span
        className="leading-none"
        style={{
          fontSize: size * 0.78,
          color: piece[0] === "w" ? "#f8fafc" : "#1a2233",
          textShadow: piece[0] === "w"
            ? "0 2px 3px rgba(0,0,0,0.55), 0 0 1px #64748b"
            : "0 2px 3px rgba(0,0,0,0.7), 0 0 1px #94a3b8",
          filter: selected ? "drop-shadow(0 0 8px #22d3ee)" : mine ? "none" : "none",
          transform: selected ? "scale(1.15)" : "none",
          transition: "transform 0.12s",
        }}
      >
        {GLYPH[piece]}
      </span>
    </div>
  );
}

/**
 * Reusable interactive board (multiplayer + puzzle mode). Pure render: the
 * caller owns the chess.js instance, selection and click handling.
 */
export function ChessBoard({ chess, flipped, selected, legalTargets, lastMove, onSquare, overlay }) {
  const boardRef = useRef(null);
  const [size, setSize] = useState(52);

  useEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize(el.clientWidth / 8));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const squares = [];
  const pieces = [];
  if (chess) {
    const board = chess.board();
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const sq = `${FILES[f]}${8 - r}`;
        const x = flipped ? 7 - f : f;
        const y = flipped ? 7 - r : r;
        squares.push({ sq, x, y, dark: (r + f) % 2 === 1 });
        const cell = board[r][f];
        if (cell) pieces.push({ key: `${cell.color}${cell.type}-${sq}`, piece: cell.color + cell.type, sq, x, y });
      }
    }
  }

  return (
    <div
      ref={boardRef}
      className="relative mx-auto rounded-xl overflow-hidden shadow-2xl ring-1 ring-arcade-500/30"
      style={{ width: "min(92vw, 480px)", height: "min(92vw, 480px)" }}
    >
      {squares.map(({ sq, x, y, dark }) => {
        const isLast = sq === lastMove?.from || sq === lastMove?.to;
        const legal = legalTargets?.has(sq);
        return (
          <button
            key={sq}
            onClick={() => onSquare?.(sq)}
            className="absolute"
            style={{
              width: size, height: size, left: x * size, top: y * size,
              background: isLast
                ? (dark ? "#8a7a3a" : "#d8c86a")
                : dark
                  ? "linear-gradient(135deg,#7a5a3a,#6a4c30)"
                  : "linear-gradient(135deg,#e8d5b0,#dcc49a)",
              boxShadow: sq === selected ? "inset 0 0 0 3px #22d3ee" : "none",
            }}
          >
            {legal && (
              <span
                className="absolute inset-0 m-auto rounded-full"
                style={{
                  width: chess.get(sq) ? size * 0.85 : size * 0.3,
                  height: chess.get(sq) ? size * 0.85 : size * 0.3,
                  border: chess.get(sq) ? "3px solid rgba(34,211,238,0.8)" : "none",
                  background: chess.get(sq) ? "transparent" : "rgba(34,211,238,0.55)",
                }}
              />
            )}
          </button>
        );
      })}
      {pieces.map((p) => (
        <Piece key={p.key} piece={p.piece} x={p.x} y={p.y} size={size} selected={p.sq === selected} />
      ))}
      {overlay}
    </div>
  );
}

export { GLYPH };

export default function ChessPanel({ roomId }) {
  const lobby = useLobbyGame("chess", roomId);
  const { me, state, notices, seated, isHost, act, reset } = lobby;
  const [selected, setSelected] = useState(null); // "e2"
  const [promo, setPromo] = useState(null); // pending promotion {from,to}
  const [mode, setMode] = useState("play"); // "play" | "puzzle"
  const rx = useReactions("chess", roomId);

  // Local mirror for hints/promotion detection only — server stays boss.
  const chess = useMemo(() => {
    if (!state?.fen) return null;
    try { return new Chess(state.fen); } catch { return null; }
  }, [state?.fen]);

  const myColor = state?.whiteId === me?.id ? "w" : state?.blackId === me?.id ? "b" : null;
  const flipped = myColor === "b";
  const myTurn = chess && myColor && state.turn === myColor && !state.result;

  // Sounds keyed off state transitions.
  const prevRef = useRef(null);
  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = state;
    if (!prev || !state) return;
    if (state.lastMove && state.lastMove.san !== prev.lastMove?.san) {
      const captured = (state.captured?.w?.length || 0) + (state.captured?.b?.length || 0) >
        (prev.captured?.w?.length || 0) + (prev.captured?.b?.length || 0);
      sfx.play(captured ? "chessCapture" : "chessMove");
      if (state.check) sfx.play("check");
    }
    if (!prev.result && state.result) {
      const iWon = state.winnerId === me?.id;
      sfx.play(state.winnerId ? (iWon ? "win" : "lose") : "tick");
    }
  }, [state, me]);


  // Mode tabs (multiplayer ↔ solo puzzles) — hidden while a live match runs.
  const tabs = (
    <div className="flex justify-center gap-2 mb-4">
      {[["play", "⚔️ Multiplayer"], ["puzzle", "🧩 Puzzles"]].map(([id, label]) => (
        <button
          key={id}
          onClick={() => setMode(id)}
          className={`px-4 py-1.5 rounded-full text-sm font-semibold border transition-colors ${
            mode === id
              ? "bg-arcade-400 text-gray-950 border-arcade-300 shadow-[0_0_10px_rgba(34,211,238,0.45)]"
              : "bg-gray-800 border-gray-700 hover:border-arcade-400 text-gray-300"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );

  if (mode === "puzzle" && state?.status !== "playing") {
    return (
      <div>
        {tabs}
        <PuzzlePanel />
      </div>
    );
  }

  if (!state || state.status === "lobby") {
    return (
      <div>
        {tabs}
      <GameLobby
        title="CHESS" emoji="♞" tagline="The classic. 2 players — or take on the bot."
        minPlayers={2} maxPlayers={2} lobby={lobby}
      >
        {/* Time control — same clock for both; first flag to fall loses. */}
        <div className="mt-4 pt-4 border-t border-gray-800 text-left">
          <p className="text-xs uppercase tracking-wider text-arcade-300/70 mb-1.5">
            Time control {!isHost && <span className="text-gray-600 normal-case">(host picks)</span>}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {TIME_CHOICES.map((t) => (
              <button
                key={t.m}
                disabled={!isHost}
                onClick={() => act("setTime", { minutes: t.m })}
                className={`px-2.5 py-1 rounded-md text-xs border ${
                  (state?.timeCtrlMin ?? 10) === t.m
                    ? "bg-arcade-400 text-gray-950 font-semibold border-arcade-300 shadow-[0_0_10px_rgba(34,211,238,0.45)]"
                    : "bg-gray-800 border-gray-700"
                } ${isHost ? "hover:border-arcade-400" : "opacity-70 cursor-default"}`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </GameLobby>
      </div>
    );
  }

  const legalTargets = new Set(
    selected && chess ? chess.moves({ square: selected, verbose: true }).map((m) => m.to) : []
  );

  const clickSquare = async (sq) => {
    if (!myTurn) return;
    const piece = chess.get(sq);
    if (selected && legalTargets.has(sq)) {
      // Promotion? (pawn reaching last rank)
      const moving = chess.get(selected);
      const lastRank = myColor === "w" ? "8" : "1";
      if (moving?.type === "p" && sq[1] === lastRank) {
        setPromo({ from: selected, to: sq });
        return;
      }
      setSelected(null);
      await act("move", { from: selected, to: sq });
      return;
    }
    setSelected(piece && piece.color === myColor ? sq : null);
  };

  const pickPromotion = async (p) => {
    const { from, to } = promo;
    setPromo(null);
    setSelected(null);
    await act("move", { from, to, promotion: p });
    sfx.play("home");
  };

  const nameOf = (id) => state.players?.find((p) => p.id === id)?.name || "…";
  const lastFrom = state.lastMove?.from;
  const lastTo = state.lastMove?.to;
  const capturedRow = (arr) => arr.map((t, i) => (
    <span key={i} className="text-lg opacity-80">{GLYPH[(arr === state.captured.w ? "b" : "w") + t]}</span>
  ));

  return (
    <div className="relative max-w-lg mx-auto space-y-3">
      <ReactionOverlay floats={rx.floats} />
      {state.status === "playing" && !myColor && <SpectateBanner />}

      {/* Header: players + clocks + turn */}
      <div className="flex items-center justify-between bg-gray-900/80 border border-arcade-500/20 rounded-xl px-3 py-2 text-sm gap-2">
        <span className="flex items-center gap-1.5 min-w-0">
          <Clock baseMs={state.whiteMs} running={state.turn === "w"} turnStartedAt={state.turnStartedAt} result={state.result} />
          <span className={`truncate ${state.turn === "w" && !state.result ? "text-arcade-300 font-semibold" : "text-gray-400"}`}>
            ⬜ {nameOf(state.whiteId)}
          </span>
        </span>
        {state.result ? (
          <span className="font-bold text-amber-300 shrink-0">{RESULT_TEXT[state.result] || state.result}</span>
        ) : state.check ? (
          <span className="font-bold text-red-400 animate-pulse shrink-0">CHECK!</span>
        ) : (
          <span className="text-gray-500 text-xs shrink-0">{state.turn === myColor ? "your move" : "thinking…"}</span>
        )}
        <span className="flex items-center gap-1.5 min-w-0">
          <span className={`truncate ${state.turn === "b" && !state.result ? "text-arcade-300 font-semibold" : "text-gray-400"}`}>
            {nameOf(state.blackId)} ⬛
          </span>
          <Clock baseMs={state.blackMs} running={state.turn === "b"} turnStartedAt={state.turnStartedAt} result={state.result} />
        </span>
      </div>

      {/* Board */}
      <ChessBoard
        chess={chess}
        flipped={flipped}
        selected={selected}
        legalTargets={legalTargets}
        lastMove={{ from: lastFrom, to: lastTo }}
        onSquare={clickSquare}
        overlay={promo && (
          <div className="absolute inset-0 z-30 bg-black/60 flex items-center justify-center gap-2">
            {["q", "r", "b", "n"].map((p) => (
              <button key={p} onClick={() => pickPromotion(p)}
                className="w-14 h-14 rounded-xl bg-gray-100 hover:bg-arcade-300 text-4xl flex items-center justify-center shadow-lg">
                {GLYPH[(myColor || "w") + p]}
              </button>
            ))}
          </div>
        )}
      />

      {/* Captured trays + notices + actions */}
      <div className="flex items-center justify-between text-sm px-1 min-h-[1.8rem]">
        <div className="flex gap-0.5">{capturedRow(state.captured?.w || [])}</div>
        <div className="flex gap-0.5">{capturedRow(state.captured?.b || [])}</div>
      </div>
      <ReactionBar send={rx.send} className="max-w-xs mx-auto" />
      <NoticeFeed notices={notices} />
      <div className="flex justify-center gap-2">
        {!state.result && myColor && (
          <Button variant="secondary" onClick={() => act("resign")}>🏳️ Resign</Button>
        )}
        {state.result && isHost && <Button variant="arcade" onClick={reset}>Play again</Button>}
      </div>
      {state.result && state.winnerId && (
        <p className="text-center font-bold text-arcade-300 text-lg">
          🏆 {nameOf(state.winnerId)} wins{seated && state.winnerId === me?.id ? " — that's you!" : "!"}
        </p>
      )}
    </div>
  );
}
