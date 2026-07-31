/**
 * Bingo (75-ball) — pure logic. Column ranges B1-15 / I16-30 / N31-45 /
 * G46-60 / O61-75, free center. First VALID line (row, column or diagonal)
 * of daubed-and-actually-called numbers wins — the server re-checks every
 * claim, so pressing BINGO on a lie does nothing but embarrass you.
 */

export const LETTERS = ["B", "I", "N", "G", "O"];

export function letterFor(n) {
  return LETTERS[Math.floor((n - 1) / 15)];
}

/** A 5×5 card: card[col][row]; card[2][2] = 0 is the free space. */
export function genCard(rand = Math.random) {
  const card = [];
  for (let col = 0; col < 5; col++) {
    const pool = [];
    for (let n = col * 15 + 1; n <= col * 15 + 15; n++) pool.push(n);
    const picks = [];
    for (let i = 0; i < 5; i++) {
      picks.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
    }
    card.push(picks);
  }
  card[2][2] = 0; // free
  return card;
}

export function setup(playerIds, rand = Math.random) {
  const balls = [];
  for (let n = 1; n <= 75; n++) balls.push(n);
  for (let i = balls.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [balls[i], balls[j]] = [balls[j], balls[i]];
  }
  const cards = {};
  const daubs = {};
  for (const id of playerIds) {
    cards[id] = genCard(rand);
    daubs[id] = [[false, false, false, false, false], [false, false, false, false, false],
      [false, false, true, false, false], [false, false, false, false, false], [false, false, false, false, false]];
  }
  return { balls, drawn: [], cards, daubs, winnerId: null, winningLine: null };
}

export function drawBall(b) {
  if (b.balls.length === 0) return null;
  const n = b.balls.pop();
  b.drawn.push(n);
  return n;
}

/** Daub is only valid if the number is on the card AND has been called. */
export function daub(b, playerId, n) {
  if (!b.drawn.includes(n)) return false;
  const card = b.cards[playerId];
  if (!card) return false;
  for (let c = 0; c < 5; c++) {
    for (let r = 0; r < 5; r++) {
      if (card[c][r] === n) {
        b.daubs[playerId][c][r] = true;
        return true;
      }
    }
  }
  return false;
}

/** Any complete row / column / diagonal of daubs? Returns the line or null. */
export function findLine(b, playerId) {
  const d = b.daubs[playerId];
  if (!d) return null;
  for (let c = 0; c < 5; c++) {
    if (d[c].every(Boolean)) return { kind: "col", index: c };
  }
  for (let r = 0; r < 5; r++) {
    if ([0, 1, 2, 3, 4].every((c) => d[c][r])) return { kind: "row", index: r };
  }
  if ([0, 1, 2, 3, 4].every((i) => d[i][i])) return { kind: "diag", index: 0 };
  if ([0, 1, 2, 3, 4].every((i) => d[i][4 - i])) return { kind: "diag", index: 1 };
  return null;
}

// ── Turn-pick variant (the schoolyard classic) ──────────────────────────────
// Every player arranges 1..25 on a 5×5 card (random arrangement here); players
// CALL numbers turn-wise; every card contains every number, so a call daubs on
// ALL cards at once — the game is about your ARRANGEMENT. First to FIVE
// complete lines (rows + columns + diagonals, overlaps count) wins.

export const LINES_TO_WIN = 5;

/** A 5×5 card holding a random permutation of 1..25 (card[col][row]). */
export function genCard25(rand = Math.random) {
  const nums = Array.from({ length: 25 }, (_, i) => i + 1);
  for (let i = nums.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [nums[i], nums[j]] = [nums[j], nums[i]];
  }
  const card = [];
  for (let c = 0; c < 5; c++) card.push(nums.slice(c * 5, c * 5 + 5));
  return card;
}

export function setupTurns(playerIds, rand = Math.random) {
  const cards = {};
  for (const id of playerIds) cards[id] = genCard25(rand);
  return { variant: "turns", called: [], cards, turnIdx: 0, winnerId: null };
}

/** Complete lines (rows 5 + cols 5 + diags 2 → max 12) given the called set. */
export function lineCount25(card, calledSet) {
  let lines = 0;
  for (let c = 0; c < 5; c++) {
    if (card[c].every((n) => calledSet.has(n))) lines++;
  }
  for (let r = 0; r < 5; r++) {
    if ([0, 1, 2, 3, 4].every((c) => calledSet.has(card[c][r]))) lines++;
  }
  if ([0, 1, 2, 3, 4].every((i) => calledSet.has(card[i][i]))) lines++;
  if ([0, 1, 2, 3, 4].every((i) => calledSet.has(card[i][4 - i]))) lines++;
  return lines;
}

/** Call a number (turn-pick): must be 1..25 and not already called. */
export function callNumber(b, n) {
  if (!Number.isInteger(n) || n < 1 || n > 25 || b.called.includes(n)) return false;
  b.called.push(n);
  return true;
}

export function lineCounts(b, playerIds) {
  const set = new Set(b.called);
  return Object.fromEntries(playerIds.map((id) => [id, lineCount25(b.cards[id], set)]));
}

/**
 * Bot pick for the turn variant. easy = random; medium/hard = greedy — the
 * uncalled number that raises the bot's OWN line count most (hard breaks ties
 * by how close it brings its best lines to completion).
 */
export function bestPick(b, botId, difficulty, rand = Math.random) {
  const uncalled = [];
  for (let n = 1; n <= 25; n++) if (!b.called.includes(n)) uncalled.push(n);
  if (uncalled.length === 0) return null;
  if (difficulty === "easy") return uncalled[Math.floor(rand() * uncalled.length)];

  const set = new Set(b.called);
  const card = b.cards[botId];
  const base = lineCount25(card, set);
  let best = uncalled[0];
  let bestScore = -Infinity;
  for (const n of uncalled) {
    set.add(n);
    let score = (lineCount25(card, set) - base) * 100;
    if (difficulty === "hard") {
      // Near-complete lines are future wins — count 4/5 lines as progress.
      for (let c = 0; c < 5; c++) {
        const have = card[c].filter((x) => set.has(x)).length;
        if (have === 4) score += 5;
      }
    }
    set.delete(n);
    score += rand(); // tie-break noise
    if (score > bestScore) { bestScore = score; best = n; }
  }
  return best;
}

/** Bot behaviour: daub everything already called (with difficulty-based laziness). */
export function botDaub(b, botId, difficulty, rand = Math.random) {
  const chance = { easy: 0.5, medium: 0.85, hard: 1 }[difficulty] ?? 0.85;
  const card = b.cards[botId];
  let daubed = 0;
  for (let c = 0; c < 5; c++) {
    for (let r = 0; r < 5; r++) {
      const n = card[c][r];
      if (n !== 0 && !b.daubs[botId][c][r] && b.drawn.includes(n) && rand() < chance) {
        b.daubs[botId][c][r] = true;
        daubed++;
      }
    }
  }
  return daubed;
}
