/**
 * UNO — pure rules engine (no sockets, fully unit-testable).
 *
 * Cards are plain objects { color, value }:
 *   color: "red" | "yellow" | "green" | "blue" | "wild"
 *   value: "0".."9" | "skip" | "reverse" | "draw2" | "wild" | "wild4"
 *
 * Official-ish rules kept: skip/reverse/draw2 effects, wilds pick a color,
 * reverse acts as skip in 2-player, can't finish rules simplified (any card
 * may finish), no wild4 challenges (nobody at game night wants to litigate
 * a challenge). "UNO!" is announced automatically by the server — the fun
 * of the shout without the gotcha penalty.
 *
 * HOUSE RULE — STACKING: a +2 can be answered with another +2 (and a +4
 * with another +4), passing the accumulated penalty on. While a stack is
 * live (`u.stack = { type, count }`), the player to act may ONLY stack the
 * SAME card type or draw the whole pile. Cross-stacking (+2 on +4) is not
 * allowed.
 */

export const COLORS = ["red", "yellow", "green", "blue"];
const ACTIONS = ["skip", "reverse", "draw2"];

export function buildDeck() {
  const deck = [];
  for (const color of COLORS) {
    deck.push({ color, value: "0" });
    for (let n = 1; n <= 9; n++) {
      deck.push({ color, value: String(n) }, { color, value: String(n) });
    }
    for (const a of ACTIONS) deck.push({ color, value: a }, { color, value: a });
  }
  for (let i = 0; i < 4; i++) {
    deck.push({ color: "wild", value: "wild" }, { color: "wild", value: "wild4" });
  }
  return deck; // 108 cards
}

export function shuffle(arr, rand = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** May `card` be played on top of the pile given the active color? */
export function canPlay(card, top, activeColor) {
  if (card.color === "wild") return true;
  return card.color === activeColor || card.value === top.value;
}

/** Start a match: deal 7 each, flip a starting number card. */
export function setup(playerIds, rand = Math.random) {
  const draw = shuffle(buildDeck(), rand);
  const hands = {};
  for (const id of playerIds) hands[id] = draw.splice(0, 7);
  // The first face-up card must be a number — put anything else back randomly.
  let first = draw.pop();
  while (first.color === "wild" || ACTIONS.includes(first.value)) {
    draw.splice(Math.floor(rand() * draw.length), 0, first);
    first = draw.pop();
  }
  return {
    hands,
    drawPile: draw,
    discard: [first],
    activeColor: first.color,
    direction: 1,
    turnIdx: 0,
    pendingDraw: null, // index of a just-drawn playable card awaiting keep/play
    stack: null, // { type: "draw2"|"wild4", count } — live draw pile-up
    winnerId: null,
  };
}

/** What may be played RIGHT NOW (stack-aware — under a stack, only the same card type). */
export function playableNow(u, card) {
  if (u.stack) return card.value === u.stack.type;
  return canPlay(card, top(u), u.activeColor);
}

export const top = (u) => u.discard[u.discard.length - 1];

/** Refill the draw pile from the discard (keeping the top card) if empty. */
function ensureDrawPile(u, rand = Math.random) {
  if (u.drawPile.length > 0) return;
  const t = u.discard.pop();
  u.drawPile = shuffle(u.discard, rand);
  u.discard = [t];
}

export function drawCards(u, playerId, n, rand = Math.random) {
  const out = [];
  for (let i = 0; i < n; i++) {
    ensureDrawPile(u, rand);
    const c = u.drawPile.pop();
    if (!c) break; // pathological: every card in hands
    u.hands[playerId].push(c);
    out.push(c);
  }
  return out;
}

export function advance(u, order, steps = 1) {
  u.turnIdx = (u.turnIdx + u.direction * steps + order.length * steps) % order.length;
}

/**
 * Play `cardIdx` from `playerId`'s hand. Returns { ok, error?, effects }.
 * `chosenColor` is required for wilds. Mutates the state.
 */
export function playCard(u, order, playerId, cardIdx, chosenColor) {
  const hand = u.hands[playerId];
  const card = hand?.[cardIdx];
  if (!card) return { error: "No such card" };
  if (u.stack && card.value !== u.stack.type) {
    return { error: `Stack a +${u.stack.type === "draw2" ? 2 : 4} or draw ${u.stack.count}` };
  }
  if (!u.stack && !canPlay(card, top(u), u.activeColor)) return { error: "That card can't be played" };
  if (card.color === "wild" && !COLORS.includes(chosenColor)) return { error: "Pick a color" };

  hand.splice(cardIdx, 1);
  u.discard.push(card);
  u.activeColor = card.color === "wild" ? chosenColor : card.color;
  u.pendingDraw = null;

  const effects = { skipped: null, drew: null, reversed: false, uno: hand.length === 1, stacked: null };

  if (hand.length === 0) {
    u.winnerId = playerId;
    return { ok: true, effects };
  }

  const twoPlayer = order.length === 2;
  switch (card.value) {
    case "skip":
      advance(u, order, 2);
      effects.skipped = order[(order.indexOf(playerId) + u.direction + order.length) % order.length];
      break;
    case "reverse":
      u.direction *= -1;
      effects.reversed = true;
      // In 2p, reverse behaves as a skip (you go again).
      advance(u, order, twoPlayer ? 0 : 1);
      break;
    // HOUSE RULE: +2/+4 no longer punish immediately — they open (or grow) a
    // stack. The next player either stacks the same card type or draws the
    // whole accumulated pile (resolveStackDraw).
    case "draw2":
      u.stack = { type: "draw2", count: (u.stack?.count || 0) + 2 };
      effects.stacked = { ...u.stack };
      advance(u, order, 1);
      break;
    case "wild4":
      u.stack = { type: "wild4", count: (u.stack?.count || 0) + 4 };
      effects.stacked = { ...u.stack };
      advance(u, order, 1);
      break;
    default:
      advance(u, order, 1);
  }
  return { ok: true, effects };
}

/** The player facing a stack gives up and swallows the whole pile. */
export function resolveStackDraw(u, order, playerId, rand = Math.random) {
  if (!u.stack) return { error: "No stack to draw" };
  const n = u.stack.count;
  drawCards(u, playerId, n, rand);
  u.stack = null;
  advance(u, order, 1);
  return { ok: true, n };
}

// ── Bot ──────────────────────────────────────────────────────────────────────

const colorCounts = (hand) => {
  const c = { red: 0, yellow: 0, green: 0, blue: 0 };
  for (const card of hand) if (card.color !== "wild") c[card.color]++;
  return c;
};
export const bestColor = (hand) => {
  const c = colorCounts(hand);
  return COLORS.reduce((a, b) => (c[a] >= c[b] ? a : b));
};

/**
 * Choose the bot's action: { cardIdx, chosenColor } or { draw: true }.
 * easy   — random legal card
 * medium — keeps wilds for later, plays its majority color
 * hard   — medium + punishes low-card opponents with action cards
 */
export function botChoose(u, order, playerId, difficulty, handCounts) {
  const hand = u.hands[playerId];
  // Stack-aware: under a stack only matching cards are legal; an empty list
  // means "swallow the pile" (the caller resolves the stack draw).
  const legal = hand
    .map((card, i) => ({ card, i }))
    .filter(({ card }) => playableNow(u, card));
  if (legal.length === 0) return { draw: true };

  const pickColor = () => bestColor(hand);

  if (difficulty === "easy") {
    const pick = legal[Math.floor(Math.random() * legal.length)];
    return { cardIdx: pick.i, chosenColor: pick.card.color === "wild" ? COLORS[Math.floor(Math.random() * 4)] : null };
  }

  const nextId = order[(order.indexOf(playerId) + u.direction + order.length) % order.length];
  const nextLow = (handCounts?.[nextId] ?? 7) <= 2;

  const score = ({ card }) => {
    let s = 0;
    if (card.color !== "wild" && card.color === bestColor(hand)) s += 3; // shed the long suit
    if (["skip", "reverse", "draw2"].includes(card.value)) s += difficulty === "hard" && nextLow ? 8 : 1;
    if (card.value === "wild4") s += difficulty === "hard" && nextLow ? 9 : -4; // hoard unless punishing
    if (card.value === "wild") s += -3;
    if (!Number.isNaN(Number(card.value))) s += Number(card.value) / 10; // dump big numbers
    return s + Math.random();
  };

  legal.sort((a, b) => score(b) - score(a));
  const pick = legal[0];
  return { cardIdx: pick.i, chosenColor: pick.card.color === "wild" ? pickColor() : null };
}
