/**
 * Chess — rules ride on chess.js (battle-tested move legality, check/mate,
 * castling, en passant, promotion, draws); this module adds what chess.js
 * doesn't have: the BOT.
 *
 * Difficulty = search depth + noise, not different code paths:
 *   easy   — random legal move with a mild taste for captures
 *   medium — greedy one-ply material search with tie-break noise
 *   hard   — 2-ply minimax with alpha-beta over material + position
 */

const VALUE = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

// Positional nudge: knights/bishops/pawns like the middle, pawns like ranks.
function positional(piece, rank, file) {
  const centerBonus = 6 - (Math.abs(3.5 - file) + Math.abs(3.5 - rank));
  if (piece === "n" || piece === "b") return centerBonus * 4;
  if (piece === "p") return centerBonus * 2 + rank * 3; // rank from own side
  return 0;
}

/** Static evaluation from WHITE's perspective, in centipawns. */
export function evaluate(chess) {
  let score = 0;
  const board = chess.board();
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const sq = board[r][f];
      if (!sq) continue;
      const base = VALUE[sq.type];
      const rankFromOwnSide = sq.color === "w" ? 7 - r : r;
      const pos = positional(sq.type, rankFromOwnSide, f);
      score += sq.color === "w" ? base + pos : -(base + pos);
    }
  }
  return score;
}

function search(chess, depth, alpha, beta, maximizing) {
  if (depth === 0 || chess.isGameOver()) {
    if (chess.isCheckmate()) return maximizing ? -100000 : 100000;
    if (chess.isDraw()) return 0;
    return evaluate(chess);
  }
  const moves = chess.moves();
  if (maximizing) {
    let best = -Infinity;
    for (const m of moves) {
      chess.move(m);
      best = Math.max(best, search(chess, depth - 1, alpha, beta, false));
      chess.undo();
      alpha = Math.max(alpha, best);
      if (beta <= alpha) break;
    }
    return best;
  }
  let best = Infinity;
  for (const m of moves) {
    chess.move(m);
    best = Math.min(best, search(chess, depth - 1, alpha, beta, true));
    chess.undo();
    beta = Math.min(beta, best);
    if (beta <= alpha) break;
  }
  return best;
}

/**
 * Pick the bot's move (SAN string) for the side to move. Never returns an
 * illegal move — every candidate comes from chess.moves().
 */
export function chooseBotMove(chess, difficulty = "medium") {
  const moves = chess.moves({ verbose: true });
  if (moves.length === 0) return null;

  if (difficulty === "easy") {
    const captures = moves.filter((m) => m.captured);
    const pool = captures.length && Math.random() < 0.45 ? captures : moves;
    return pool[Math.floor(Math.random() * pool.length)].san;
  }

  const white = chess.turn() === "w";
  const depth = difficulty === "hard" ? 2 : 1;
  let best = [];
  let bestScore = -Infinity;
  for (const m of moves) {
    chess.move(m.san);
    // Opponent replies (or static eval at depth 1).
    const raw = search(chess, depth - 1, -Infinity, Infinity, !white ? true : false);
    chess.undo();
    const score = (white ? raw : -raw) + (difficulty === "medium" ? Math.random() * 25 : Math.random() * 5);
    if (score > bestScore + 0.001) { bestScore = score; best = [m.san]; }
    else if (Math.abs(score - bestScore) <= 0.001) best.push(m.san);
  }
  return best[Math.floor(Math.random() * best.length)];
}

/** Human-readable end reason, or null while the game continues. */
export function gameResult(chess) {
  if (chess.isCheckmate()) return { type: "checkmate", winner: chess.turn() === "w" ? "b" : "w" };
  if (chess.isStalemate()) return { type: "stalemate", winner: null };
  if (chess.isThreefoldRepetition()) return { type: "repetition", winner: null };
  if (chess.isInsufficientMaterial()) return { type: "material", winner: null };
  if (chess.isDraw()) return { type: "draw", winner: null };
  return null;
}
