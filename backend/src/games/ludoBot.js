/**
 * Ludo — bot player AI.
 *
 * A bot occupies an ordinary seat (`{ id: "bot:red", name, isBot, difficulty }`)
 * and plays through the SAME `doRoll` / `doMove` functions a human's socket
 * events call. The AI's only job is to answer one question: given the dice and
 * the list of legal tokens, which token should move?
 *
 * Difficulty is expressed as how much of the board the bot actually reasons
 * about:
 *   easy   — picks at random (with a nudge to prefer capturing when obvious)
 *   medium — greedy: ranks moves by immediate payoff (capture > home > …)
 *   hard   — scores every move, including the RISK of where it lands: how many
 *            enemy tokens could reach that square on their next roll.
 */
import { COLORS, SAFE, TRACK_LEN, FINISH, trackIndex } from "./ludoBoard.js";

export const DIFFICULTIES = ["easy", "medium", "hard"];
export const DEFAULT_DIFFICULTY = "medium";

// Turn pacing (ms) — bots "think" so the game stays watchable.
export const BOT_DELAYS = {
  easy: { roll: 900, move: 800 },
  medium: { roll: 700, move: 650 },
  hard: { roll: 550, move: 500 },
};
export const delaysFor = (d) => BOT_DELAYS[d] || BOT_DELAYS[DEFAULT_DIFFICULTY];

// How far ahead of a square an enemy can be sitting and still land on it with
// a 1..6 roll.
const REACH = 6;

// Where a token ends up if this move is played.
function landingStep(step, dice) {
  return step === 0 ? 1 : step + dice;
}

// The opponents that would be captured by landing on `ti` (a shared-track cell).
function capturesAt(g, color, ti) {
  const victims = [];
  if (ti === -1 || SAFE.has(ti)) return victims;
  for (const other of g.order) {
    if (other === color) continue;
    (g.tokens[other] || []).forEach((s, i) => {
      if (trackIndex(other, s) === ti) victims.push({ color: other, token: i, step: s });
    });
  }
  return victims;
}

// How exposed is a shared-track cell? Counts enemy tokens sitting 1..6 cells
// behind it (i.e. able to land on it next turn). Safe cells are never exposed.
function dangerAt(g, color, ti) {
  if (ti === -1 || SAFE.has(ti)) return 0;
  let threats = 0;
  for (const other of g.order) {
    if (other === color) continue;
    (g.tokens[other] || []).forEach((s) => {
      const oti = trackIndex(other, s);
      if (oti === -1) return;
      // Distance from the enemy token forward to our cell, around the loop.
      const gap = (ti - oti + TRACK_LEN) % TRACK_LEN;
      if (gap >= 1 && gap <= REACH) threats += 1;
    });
  }
  return threats;
}

/**
 * Score a single candidate move. Higher is better. Used by medium (payoff only)
 * and hard (payoff minus risk).
 */
function scoreMove(g, color, token, dice, { useRisk }) {
  const step = g.tokens[color][token];
  const next = landingStep(step, dice);
  const ti = trackIndex(color, next);
  let score = 0;

  // Immediate payoffs.
  const victims = capturesAt(g, color, ti);
  for (const v of victims) score += 90 + v.step * 1.2; // the further along, the sweeter
  if (next === FINISH) score += 80; // token home for good
  if (step === 0) score += 45; // getting out of the yard is strong tempo
  if (next > 51) score += 25; // inside the home column = untouchable
  if (SAFE.has(ti)) score += 14; // parked on a star
  score += next * 0.35; // general progress

  if (useRisk) {
    // Landing somewhere reachable by an enemy is a real cost; leaving a token
    // where it already stands in danger is a reason TO move it.
    score -= dangerAt(g, color, ti) * 26;
    const hereTi = trackIndex(color, step);
    score += dangerAt(g, color, hereTi) * 18;
    // Prefer advancing the token nearest home when nothing else separates moves.
    if (next > 45) score += 8;
  }

  return score;
}

/**
 * Choose which token to move. `movable` is the server-computed list of legal
 * token indices — the bot can only ever pick from it, so a bot can no more
 * cheat than a client can.
 */
export function chooseMove(g, color, movable, difficulty = DEFAULT_DIFFICULTY) {
  if (!movable || movable.length === 0) return null;
  if (movable.length === 1) return movable[0];
  const dice = g.dice;

  if (difficulty === "easy") {
    // Mostly random, but takes a free capture about half the time — enough to
    // feel alive without being sharp.
    if (Math.random() < 0.5) {
      const capture = movable.find(
        (t) => capturesAt(g, color, trackIndex(color, landingStep(g.tokens[color][t], dice))).length > 0
      );
      if (capture !== undefined) return capture;
    }
    return movable[Math.floor(Math.random() * movable.length)];
  }

  const useRisk = difficulty === "hard";
  let best = movable[0];
  let bestScore = -Infinity;
  for (const t of movable) {
    const s = scoreMove(g, color, t, dice, { useRisk });
    if (s > bestScore) { bestScore = s; best = t; }
  }
  return best;
}

// Bot seat identity.
const BOT_NAMES = { red: "Ruby", green: "Fern", yellow: "Sunny", blue: "Sky" };
export function botSeat(color, difficulty) {
  const label = { easy: "Easy", medium: "Med", hard: "Hard" }[difficulty] || "Med";
  return {
    id: `bot:${color}`,
    name: `${BOT_NAMES[color] || "Bot"} (${label})`,
    isBot: true,
    difficulty,
  };
}

export { COLORS };
