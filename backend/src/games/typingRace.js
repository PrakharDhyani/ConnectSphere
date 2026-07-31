/**
 * Typing race — pure logic. Players race through the same passage; progress
 * is "correct characters typed". The server validates progress reports
 * (monotonic + a superhuman-rate cap) instead of trusting clients, and
 * simulates bots as WPM profiles with human-ish jitter.
 */

export const TEXTS = [
  "The quick brown fox jumps over the lazy dog while the farmer watches from his porch and wonders where the years have gone.",
  "Somewhere beyond the mountains a train whistles twice, and the whole valley seems to pause and listen before returning to its work.",
  "Great software is not written in a burst of genius but grown patiently, one small honest improvement layered upon another.",
  "The library smelled of old paper and quiet ambition, and every shelf promised a hundred lives she had not yet lived.",
  "Rain tapped against the window like a polite stranger, and the cat refused to acknowledge that anything existed beyond the radiator.",
  "A good race is not about being faster than everyone else; it is about being faster than you were yesterday.",
  "The chef tasted the soup, frowned at the ceiling for a long moment, then added exactly three more grains of salt.",
  "On the last day of summer the kids built a rocket from cardboard and hope, and swore next year they would reach the moon.",
  "Debugging is like being the detective in a crime movie where you are also, inconveniently, the prime suspect.",
  "The lighthouse keeper wrote one sentence in his journal every night, and after forty years he had written the sea itself.",
  "Practice does not make perfect; practice makes permanent, so be careful what you rehearse when nobody is watching.",
  "Under the floorboards of the old house the previous owner had hidden nothing but a chess piece and a note that said checkmate.",
  "The orchestra tuned to a single trembling note, and for one second the entire concert hall breathed in unison.",
  "Typing fast is mostly the art of making fewer mistakes slightly quicker than everyone else makes theirs.",
  "The gardener planted trees whose shade she would never sit in, and called that the whole point of gardening.",
  "By midnight the city had folded itself into silence, except for one bakery window glowing like a small stubborn sun.",
];

export const COUNTDOWN_MS = 3500;
export const RACE_TIMEOUT_MS = 120_000;
export const TIMED_MS = 60_000; // the 60-second record-setting mode

// Common-word pool for the timed mode's endless stream (monkeytype-style).
export const WORDS = (
  "the of and to in is you that it he was for on are as with his they at be this have from or one had by " +
  "word but not what all were we when your can said there use an each which she do how their if will up other " +
  "about out many then them these so some her would make like him into time has look two more write go see " +
  "number no way could people my than first water been call who oil its now find long down day did get come " +
  "made may part over new sound take only little work know place year live me back give most very after thing " +
  "our just name good sentence man think say great where help through much before line right too mean old any " +
  "same tell boy follow came want show also around form three small set put end does another well large must " +
  "big even such because turn here why ask went men read need land different home us move try kind hand picture " +
  "again change off play spell air away animal house point page letter mother answer found study still learn " +
  "should world high every near add food between own below country plant last school father keep tree never " +
  "start city earth eye light thought head under story saw left dont few while along might close something seem " +
  "next hard open example begin life always those both paper together got group often run important until side " +
  "feet car mile night walk white sea began grow took river four carry state once book hear stop without second"
).split(" ");

/** N random words joined into one stream — more than anyone can clear in 60s. */
export function wordStream(count, rand = Math.random) {
  const out = [];
  for (let i = 0; i < count; i++) out.push(WORDS[Math.floor(rand() * WORDS.length)]);
  return out.join(" ");
}
// Anti-cheat ceiling: 250 WPM ≈ 21 chars/sec. Faster than the world record
// pace means the client is lying — clamp, don't trust.
export const MAX_CHARS_PER_SEC = 21;

export const BOT_WPM = {
  easy: [28, 38],
  medium: [45, 60],
  hard: [72, 92],
};

export function pickText(rand = Math.random) {
  return TEXTS[Math.floor(rand() * TEXTS.length)];
}

export function setup(playerIds, rand = Math.random, mode = "race") {
  // Timed mode: a fixed 60s window over an endless word stream. 280 words
  // (~1600 chars) is beyond the anti-cheat ceiling (21 chars/s × 60s = 1260),
  // so the stream can never run dry for a legitimate typist.
  const timed = mode === "timed";
  const text = timed ? wordStream(280, rand) : pickText(rand);
  const now = Date.now();
  const progress = {};
  for (const id of playerIds) {
    progress[id] = { chars: 0, errors: 0, wpm: 0, finishedAt: null };
  }
  return {
    mode,
    text,
    startAt: now + COUNTDOWN_MS,
    endAt: now + COUNTDOWN_MS + (timed ? TIMED_MS : RACE_TIMEOUT_MS),
    progress,
    botState: {}, // id -> { wpm, nextBurstAt }
    finishOrder: [],
  };
}

/** Validate + apply a progress report. Returns true if the racer just finished. */
export function applyProgress(race, playerId, chars, errors, now = Date.now()) {
  const p = race.progress[playerId];
  if (!p || p.finishedAt || now < race.startAt) return false;
  const elapsed = Math.max(0.5, (now - race.startAt) / 1000);
  const cap = Math.ceil(elapsed * MAX_CHARS_PER_SEC);
  const next = Math.min(race.text.length, Math.max(p.chars, Math.floor(chars)), cap);
  p.chars = next;
  p.errors = Math.max(p.errors, Math.floor(errors) || 0);
  p.wpm = Math.round(next / 5 / (elapsed / 60));
  if (next >= race.text.length) {
    p.finishedAt = now;
    race.finishOrder.push(playerId);
    return true;
  }
  return false;
}

/** Advance every bot along its WPM profile. Called from the game ticker. */
export function tickBots(race, bots, now = Date.now()) {
  if (now < race.startAt) return [];
  const finished = [];
  for (const bot of bots) {
    const p = race.progress[bot.id];
    if (!p || p.finishedAt) continue;
    let bs = race.botState[bot.id];
    if (!bs) {
      const [lo, hi] = BOT_WPM[bot.difficulty] || BOT_WPM.medium;
      bs = race.botState[bot.id] = { wpm: lo + Math.random() * (hi - lo), pauseUntil: 0 };
    }
    // Occasional micro-pauses make the bar movement feel human.
    if (now < bs.pauseUntil) continue;
    if (Math.random() < 0.06) { bs.pauseUntil = now + 300 + Math.random() * 700; continue; }
    const charsPerSec = (bs.wpm * 5) / 60;
    const elapsed = (now - race.startAt) / 1000;
    const target = Math.min(race.text.length, Math.floor(elapsed * charsPerSec * (0.92 + Math.random() * 0.16)));
    if (target > p.chars) {
      p.chars = target;
      p.wpm = Math.round(p.chars / 5 / Math.max(0.01, elapsed / 60));
      if (p.chars >= race.text.length) {
        p.finishedAt = now;
        race.finishOrder.push(bot.id);
        finished.push(bot.id);
      }
    }
  }
  return finished;
}

// Two modes:
//   "race"  — a passage sprint: ends the moment ANYONE finishes (winner takes
//             it; the rest are ranked by distance covered)
//   "timed" — 60 seconds, endless words: everyone types until the clock runs
//             out; highest WPM wins and sets global records
export function raceOver(race, playerIds, now = Date.now(), mode = "race") {
  if (now >= race.endAt) return true;
  if (mode === "timed") return false; // only the clock ends a timed run
  return race.finishOrder.length > 0;
}

/** Final standings: finishers in order, then the rest by progress. */
export function standings(race, playerIds) {
  const unfinished = playerIds
    .filter((id) => !race.progress[id]?.finishedAt)
    .sort((a, b) => (race.progress[b]?.chars ?? 0) - (race.progress[a]?.chars ?? 0));
  return [...race.finishOrder, ...unfinished];
}
