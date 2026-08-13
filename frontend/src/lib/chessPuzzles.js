/**
 * Chess puzzle GENERATOR — no database, no external API.
 *
 * Answering "can we generate random puzzles every day?": yes — we generate
 * them ourselves. Random sparse positions are constructed (kings + a few
 * attackers/defenders), validated with chess.js, then SEARCHED for a forced
 * mate. Only positions with a PROVEN forced mate ship as puzzles, so every
 * puzzle is solvable by construction:
 *
 *   easy   — mate in 1 (queen+rook style endings)
 *   medium — forced mate in 2, with no mate-in-1 shortcut
 *   hard   — forced mate in 2 through enemy defenders (harder to spot)
 *
 * "Daily" = the RNG is seeded from today's date, so everyone on the platform
 * gets the SAME daily puzzle — leaderboard-arguable at game night.
 *
 * The search only considers forcing candidates (checks/captures) for the key
 * move, which is both fast and puzzle-like: real tactics start with force.
 */
import { Chess } from "chess.js";

// Deterministic RNG (same one the kart maps use).
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const dailySeed = (d = new Date()) =>
  d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();

function kingsTouch(a, b) {
  return Math.abs(a.f - b.f) <= 1 && Math.abs(a.r - b.r) <= 1;
}

/** Build a FEN from placed pieces (white to move). */
function buildFen(placed) {
  const board = Array.from({ length: 8 }, () => Array(8).fill(null));
  for (const p of placed) board[p.r][p.f] = p.piece;
  const rows = [];
  for (let r = 7; r >= 0; r--) {
    let row = "", empty = 0;
    for (let f = 0; f < 8; f++) {
      const pc = board[r][f];
      if (!pc) { empty++; continue; }
      if (empty) { row += empty; empty = 0; }
      row += pc;
    }
    if (empty) row += empty;
    rows.push(row);
  }
  return `${rows.join("/")} w - - 0 1`;
}

/** Random legal-ish sparse position; null if chess.js rejects it. */
function randomPosition(rng, whitePieces, blackPieces, { bkOnEdge = false } = {}) {
  const spots = [];
  const taken = new Set();
  const place = (piece, edge = false) => {
    for (let tries = 0; tries < 40; tries++) {
      let f = Math.floor(rng() * 8), r = Math.floor(rng() * 8);
      // Mating nets live at the board's rim — bias the hunted king there so
      // far fewer generated positions are searched in vain.
      if (edge) {
        if (rng() < 0.5) f = rng() < 0.5 ? 0 : 7;
        else r = rng() < 0.5 ? 0 : 7;
      }
      const key = `${f},${r}`;
      if (taken.has(key)) continue;
      // Pawns can't sit on first/last ranks.
      if (piece.toLowerCase() === "p" && (r === 0 || r === 7)) continue;
      taken.add(key);
      spots.push({ f, r, piece });
      return spots[spots.length - 1];
    }
    return null;
  };

  const wk = place("K");
  const bk = place("k", bkOnEdge);
  if (!wk || !bk || kingsTouch(wk, bk)) return null;
  for (const p of whitePieces) if (!place(p)) return null;
  for (const p of blackPieces) if (!place(p.toLowerCase())) return null;

  try {
    const c = new Chess(buildFen(spots));
    if (c.isCheck() || c.isGameOver()) return null; // clean starting point
    return c;
  } catch {
    return null;
  }
}

/** All immediately mating moves for the side to move. */
export function mateInOneMoves(c) {
  const out = [];
  for (const m of c.moves()) {
    c.move(m);
    if (c.isCheckmate()) out.push(m);
    c.undo();
  }
  return out;
}

// Key-move candidates for deep mates: forcing moves (checks, then captures).
// Quiet first moves never count as the solution — puzzles stay canonical and
// the search stays shallow.
function forcingMoves(c) {
  const all = c.moves();
  const checks = all.filter((m) => m.includes("+") || m.includes("#"));
  const captures = all.filter((m) => m.includes("x") && !checks.includes(m));
  return [...checks, ...captures];
}

/**
 * Does the side to move FORCE mate in ≤ n (considering every defense)?
 * Returns a key move or null. Candidates are forcing-only for n ≥ 2.
 */
export function forcedMateKey(c, n) {
  if (n <= 0) return null;
  const candidates = n === 1 ? c.moves() : forcingMoves(c);
  for (const m of candidates) {
    c.move(m);
    if (c.isCheckmate()) { c.undo(); return m; }
    if (n > 1 && !c.isGameOver()) {
      const replies = c.moves();
      let holds = replies.length > 0;
      for (const r of replies) {
        c.move(r);
        const sub = forcedMateKey(c, n - 1);
        c.undo();
        if (!sub) { holds = false; break; }
      }
      if (holds) { c.undo(); return m; }
    }
    c.undo();
  }
  return null;
}

/** After the user's (already played) move, does mate stay forced for every defense? */
export function defenseCannotEscape(c, remaining) {
  if (c.isCheckmate()) return true;
  if (remaining <= 1) return false; // had to be mate NOW
  if (c.isGameOver()) return false; // stalemate/draw = blown puzzle
  for (const r of c.moves()) {
    c.move(r);
    const sub = forcedMateKey(c, remaining - 1);
    c.undo();
    if (!sub) return false;
  }
  return true;
}

const RECIPES = {
  easy: {
    mateIn: 1,
    attempts: 600,
    configs: [["Q", "R"], ["Q", "Q"], ["R", "R"], ["Q", "B"], ["Q", "N"]],
    defenders: [],
  },
  medium: {
    mateIn: 2,
    attempts: 900,
    configs: [["Q", "R"], ["Q", "B"], ["Q", "N"], ["R", "R"]],
    defenders: [[], ["p"], ["n"]],
  },
  hard: {
    mateIn: 2,
    attempts: 1200,
    configs: [["Q", "N"], ["Q", "B"], ["R", "R"], ["Q", "R"]],
    defenders: [["r"], ["b", "p"], ["n", "p"], ["r", "p"]],
  },
};

/**
 * Generate a verified puzzle: { fen, mateIn, key } or null if the attempt
 * budget runs out (caller may retry — in practice easy/medium succeed in a
 * handful of attempts; hard can take a few hundred).
 */
export function generatePuzzle(difficulty = "medium", rng = Math.random) {
  const recipe = RECIPES[difficulty] || RECIPES.medium;
  for (let i = 0; i < recipe.attempts; i++) {
    const white = recipe.configs[Math.floor(rng() * recipe.configs.length)];
    const defs = recipe.defenders.length
      ? recipe.defenders[Math.floor(rng() * recipe.defenders.length)]
      : [];
    const c = randomPosition(rng, white, defs, { bkOnEdge: recipe.mateIn > 1 });
    if (!c) continue;

    if (recipe.mateIn === 1) {
      const mates = mateInOneMoves(c);
      if (mates.length > 0) return { fen: c.fen(), mateIn: 1, key: mates[0] };
      continue;
    }

    // Exactly-2: no mate-in-1 shortcut allowed, mate must be forced.
    if (mateInOneMoves(c).length > 0) continue;
    const key = forcedMateKey(c, 2);
    if (key) return { fen: c.fen(), mateIn: 2, key };
  }
  return null;
}

/** One generation attempt (a single random position). Exposed for chunking. */
export function attemptPuzzle(difficulty, rng) {
  const recipe = RECIPES[difficulty] || RECIPES.medium;
  const white = recipe.configs[Math.floor(rng() * recipe.configs.length)];
  const defs = recipe.defenders.length
    ? recipe.defenders[Math.floor(rng() * recipe.defenders.length)]
    : [];
  const c = randomPosition(rng, white, defs, { bkOnEdge: recipe.mateIn > 1 });
  if (!c) return null;
  if (recipe.mateIn === 1) {
    const mates = mateInOneMoves(c);
    return mates.length ? { fen: c.fen(), mateIn: 1, key: mates[0] } : null;
  }
  if (mateInOneMoves(c).length > 0) return null;
  const key = forcedMateKey(c, 2);
  return key ? { fen: c.fen(), mateIn: 2, key } : null;
}

/**
 * Async generation in small batches — the search never blocks the UI thread
 * for more than ~one batch, so music/animations keep running while "forging".
 */
export function generatePuzzleAsync(difficulty = "medium", rng = Math.random) {
  const recipe = RECIPES[difficulty] || RECIPES.medium;
  return new Promise((resolve) => {
    let attempts = 0;
    const batch = () => {
      for (let i = 0; i < 15; i++) {
        attempts++;
        const p = attemptPuzzle(difficulty, rng);
        if (p) return resolve(p);
        if (attempts >= recipe.attempts * 2) return resolve(null);
      }
      setTimeout(batch, 0); // yield to the event loop between batches
    };
    batch();
  });
}

/** The whole platform gets the same puzzle on the same day. */
export function dailyPuzzle() {
  const rng = mulberry32(dailySeed());
  return generatePuzzle("medium", rng) || generatePuzzle("easy", rng);
}

export async function dailyPuzzleAsync() {
  const rng = mulberry32(dailySeed());
  return (await generatePuzzleAsync("medium", rng)) || generatePuzzleAsync("easy", rng);
}
