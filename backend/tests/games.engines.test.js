/**
 * Engine tests for the four lobby games. All four engines are pure modules —
 * the whole point of splitting rules from socket glue.
 */
import { Chess } from "chess.js";
import { chooseBotMove, evaluate, gameResult } from "../src/games/chessGame.js";
import * as U from "../src/games/unoGame.js";
import * as T from "../src/games/typingRace.js";
import * as B from "../src/games/bingoGame.js";

// ── Chess ────────────────────────────────────────────────────────────────────

describe("chess bot", () => {
  test("always produces a legal move, at every difficulty, from random positions", () => {
    for (const d of ["easy", "medium", "hard"]) {
      const c = new Chess();
      for (let i = 0; i < 30 && !c.isGameOver(); i++) {
        const san = chooseBotMove(c, d);
        expect(c.moves()).toContain(san);
        c.move(san);
      }
    }
  });

  test("hard bot takes a hanging queen", () => {
    // White queen sits undefended where black's rook can take it.
    const c = new Chess("k7/8/8/8/3q4/8/3R4/K7 w - - 0 1"); // white to move: Rd2xd4
    const san = chooseBotMove(c, "hard");
    expect(san).toBe("Rxd4");
  });

  test("hard bot delivers mate in one when available", () => {
    const c = new Chess("6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1"); // Ra8#
    const san = chooseBotMove(c, "hard");
    c.move(san);
    expect(c.isCheckmate()).toBe(true);
  });

  test("evaluate favors material advantage", () => {
    const even = evaluate(new Chess());
    const upAQueen = evaluate(new Chess("k7/8/8/8/8/8/8/QK6 w - - 0 1"));
    expect(Math.abs(even)).toBeLessThan(100);
    expect(upAQueen).toBeGreaterThan(700);
  });

  test("gameResult detects checkmate with the right winner", () => {
    const c = new Chess();
    ["f3", "e5", "g4", "Qh4#"].forEach((m) => c.move(m)); // fool's mate — black wins
    expect(gameResult(c)).toEqual({ type: "checkmate", winner: "b" });
  });
});

// ── UNO ──────────────────────────────────────────────────────────────────────

describe("uno engine", () => {
  const rng = () => 0.42; // deterministic-ish shuffles

  test("deck is a legal 108-card UNO deck", () => {
    const deck = U.buildDeck();
    expect(deck).toHaveLength(108);
    expect(deck.filter((c) => c.value === "wild4")).toHaveLength(4);
    expect(deck.filter((c) => c.color === "red" && c.value === "0")).toHaveLength(1);
    expect(deck.filter((c) => c.color === "blue" && c.value === "7")).toHaveLength(2);
  });

  test("setup deals 7 cards each and flips a number card", () => {
    const u = U.setup(["a", "b", "c"]);
    expect(u.hands.a).toHaveLength(7);
    expect(u.hands.c).toHaveLength(7);
    expect(Number.isNaN(Number(U.top(u).value))).toBe(false);
    expect(u.activeColor).toBe(U.top(u).color);
  });

  test("canPlay: color match, value match, wild always", () => {
    const topCard = { color: "red", value: "5" };
    expect(U.canPlay({ color: "red", value: "9" }, topCard, "red")).toBe(true);
    expect(U.canPlay({ color: "blue", value: "5" }, topCard, "red")).toBe(true);
    expect(U.canPlay({ color: "blue", value: "9" }, topCard, "red")).toBe(false);
    expect(U.canPlay({ color: "wild", value: "wild" }, topCard, "red")).toBe(true);
    // Active color can differ from top card (after a wild).
    expect(U.canPlay({ color: "blue", value: "9" }, topCard, "blue")).toBe(true);
  });

  test("draw2 gives the victim two cards and skips them", () => {
    const order = ["a", "b", "c"];
    const u = U.setup(order);
    u.hands.a = [{ color: u.activeColor, value: "draw2" }, { color: "red", value: "3" }];
    const before = u.hands.b.length;
    const res = U.playCard(u, order, "a", 0, null);
    expect(res.ok).toBe(true);
    expect(u.hands.b.length).toBe(before + 2);
    expect(order[u.turnIdx]).toBe("c"); // b was skipped
  });

  test("reverse flips direction (and acts as skip for 2 players)", () => {
    const order = ["a", "b", "c"];
    const u = U.setup(order);
    u.hands.a = [{ color: u.activeColor, value: "reverse" }, { color: "red", value: "3" }];
    U.playCard(u, order, "a", 0, null);
    expect(u.direction).toBe(-1);
    expect(order[u.turnIdx]).toBe("c"); // reversed: a → c

    const two = ["x", "y"];
    const u2 = U.setup(two);
    u2.hands.x = [{ color: u2.activeColor, value: "reverse" }, { color: "red", value: "3" }];
    U.playCard(u2, two, "x", 0, null);
    expect(two[u2.turnIdx]).toBe("x"); // 2p reverse = go again
  });

  test("wild requires a color and sets it", () => {
    const order = ["a", "b"];
    const u = U.setup(order);
    u.hands.a = [{ color: "wild", value: "wild" }, { color: "red", value: "3" }];
    expect(U.playCard(u, order, "a", 0, null).error).toBeTruthy();
    const res = U.playCard(u, order, "a", 0, "green");
    expect(res.ok).toBe(true);
    expect(u.activeColor).toBe("green");
  });

  test("emptying your hand wins, and one card left announces UNO", () => {
    const order = ["a", "b"];
    const u = U.setup(order);
    u.hands.a = [{ color: u.activeColor, value: "9" }, { color: u.activeColor, value: "8" }];
    let res = U.playCard(u, order, "a", 0, null);
    expect(res.effects.uno).toBe(true);
    u.turnIdx = 0;
    res = U.playCard(u, order, "a", 0, null);
    expect(u.winnerId).toBe("a");
  });

  test("draw pile recycles the discard instead of running dry", () => {
    const u = U.setup(["a", "b"]);
    u.discard = [...u.drawPile.splice(0, u.drawPile.length), ...u.discard];
    expect(u.drawPile).toHaveLength(0);
    const got = U.drawCards(u, "a", 3);
    expect(got).toHaveLength(3);
    expect(u.discard.length).toBeGreaterThanOrEqual(1);
  });

  test("bot only ever chooses legal actions", () => {
    for (const d of ["easy", "medium", "hard"]) {
      for (let i = 0; i < 20; i++) {
        const order = ["bot", "x"];
        const u = U.setup(order);
        const choice = U.botChoose(u, order, "bot", d, { bot: 7, x: 7 });
        if (!choice.draw) {
          const card = u.hands.bot[choice.cardIdx];
          expect(U.canPlay(card, U.top(u), u.activeColor)).toBe(true);
          if (card.color === "wild") expect(U.COLORS).toContain(choice.chosenColor);
        }
      }
    }
  });
});

// ── Typing race ──────────────────────────────────────────────────────────────

describe("typing race", () => {
  test("progress is monotonic and superhuman rates are clamped", () => {
    const race = T.setup(["a"]);
    race.startAt = Date.now() - 2000; // 2s in
    T.applyProgress(race, "a", 30, 0);
    expect(race.progress.a.chars).toBe(30);
    T.applyProgress(race, "a", 10, 0); // going backwards is ignored
    expect(race.progress.a.chars).toBe(30);
    T.applyProgress(race, "a", 5000, 0); // 2500 chars/sec — lies
    expect(race.progress.a.chars).toBeLessThanOrEqual(Math.ceil(2.5 * T.MAX_CHARS_PER_SEC));
  });

  test("finishing records order", () => {
    const race = T.setup(["a", "b"]);
    race.startAt = Date.now() - 60_000;
    expect(T.applyProgress(race, "a", race.text.length, 2)).toBe(true);
    expect(race.finishOrder).toEqual(["a"]);
    expect(race.progress.a.finishedAt).not.toBeNull();
  });

  test("bots progress over time and eventually finish", () => {
    const race = T.setup(["bot1"]);
    const bots = [{ id: "bot1", difficulty: "hard" }];
    race.startAt = Date.now() - 90_000; // pretend 90s elapsed
    T.tickBots(race, bots);
    expect(race.progress.bot1.chars).toBe(race.text.length);
    expect(race.finishOrder).toContain("bot1");
  });

  test("race ends on timeout even with unfinished racers", () => {
    const race = T.setup(["a", "b"]);
    expect(T.raceOver(race, ["a", "b"], race.endAt + 1)).toBe(true);
    expect(T.raceOver(race, ["a", "b"], race.startAt + 1000)).toBe(false);
  });
});

// ── Bingo ────────────────────────────────────────────────────────────────────

describe("bingo", () => {
  test("cards obey column ranges with a free center", () => {
    const card = B.genCard();
    for (let col = 0; col < 5; col++) {
      for (let row = 0; row < 5; row++) {
        const n = card[col][row];
        if (col === 2 && row === 2) { expect(n).toBe(0); continue; }
        expect(n).toBeGreaterThanOrEqual(col * 15 + 1);
        expect(n).toBeLessThanOrEqual(col * 15 + 15);
      }
    }
    const flat = card.flat().filter((n) => n !== 0);
    expect(new Set(flat).size).toBe(24); // no duplicates
  });

  test("cannot daub an uncalled number; can daub a called one", () => {
    const b = B.setup(["a"]);
    const n = b.cards.a[0][0];
    expect(B.daub(b, "a", n)).toBe(false); // not called yet
    b.drawn.push(n);
    expect(B.daub(b, "a", n)).toBe(true);
  });

  test("findLine detects rows, columns, diagonals — and rejects noise", () => {
    const b = B.setup(["a"]);
    expect(B.findLine(b, "a")).toBeNull();
    for (let r = 0; r < 5; r++) b.daubs.a[1][r] = true;
    expect(B.findLine(b, "a")).toEqual({ kind: "col", index: 1 });

    const b2 = B.setup(["a"]);
    for (let c = 0; c < 5; c++) b2.daubs.a[c][3] = true;
    expect(B.findLine(b2, "a")).toEqual({ kind: "row", index: 3 });

    const b3 = B.setup(["a"]);
    for (let i = 0; i < 5; i++) b3.daubs.a[i][i] = true;
    expect(B.findLine(b3, "a")).toEqual({ kind: "diag", index: 0 });
  });

  test("all 75 balls draw exactly once", () => {
    const b = B.setup(["a"]);
    const seen = new Set();
    let n;
    while ((n = B.drawBall(b)) !== null) seen.add(n);
    expect(seen.size).toBe(75);
    expect(B.drawBall(b)).toBeNull();
  });

  test("hard bots daub every called number; letterFor maps ranges", () => {
    const b = B.setup(["bot"]);
    for (let i = 0; i < 40; i++) B.drawBall(b);
    B.botDaub(b, "bot", "hard");
    for (let c = 0; c < 5; c++) {
      for (let r = 0; r < 5; r++) {
        const num = b.cards.bot[c][r];
        if (num !== 0 && b.drawn.includes(num)) expect(b.daubs.bot[c][r]).toBe(true);
      }
    }
    expect(B.letterFor(1)).toBe("B");
    expect(B.letterFor(15)).toBe("B");
    expect(B.letterFor(16)).toBe("I");
    expect(B.letterFor(45)).toBe("N");
    expect(B.letterFor(75)).toBe("O");
  });
});
