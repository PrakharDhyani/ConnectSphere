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
