/**
 * Unit tests for the Ludo bot's move selection.
 *
 * `chooseMove` is pure: (board, color, legal tokens, difficulty) → token index.
 * That's what makes the difficulty levels testable as *behaviour* rather than
 * as configuration.
 */
import { chooseMove, botSeat, delaysFor, BOT_DELAYS, DIFFICULTIES } from "../src/games/ludoBot.js";
import { START, SAFE, trackIndex } from "../src/games/ludoBoard.js";

// Minimal board: only the fields chooseMove reads.
function mkBoard(tokens, dice, order = ["red", "green"]) {
  return {
    order,
    dice,
    tokens: {
      red: [0, 0, 0, 0], green: [0, 0, 0, 0],
      yellow: [0, 0, 0, 0], blue: [0, 0, 0, 0],
      ...tokens,
    },
  };
}

describe("ludo bot — legality", () => {
  test("always returns one of the legal tokens, at every difficulty", () => {
    for (const d of DIFFICULTIES) {
      for (let seed = 0; seed < 25; seed++) {
        const g = mkBoard({ red: [0, 5, 20, 40] }, 1 + (seed % 6));
        const movable = [1, 2, 3];
        const pick = chooseMove(g, "red", movable, d);
        expect(movable).toContain(pick);
      }
    }
  });

  test("returns null when there is nothing to move", () => {
    const g = mkBoard({ red: [0, 0, 0, 0] }, 3);
    expect(chooseMove(g, "red", [], "hard")).toBeNull();
    expect(chooseMove(g, "red", null, "hard")).toBeNull();
  });

  test("with a single legal move, every difficulty plays it", () => {
    const g = mkBoard({ red: [0, 0, 0, 10] }, 4);
    for (const d of DIFFICULTIES) expect(chooseMove(g, "red", [3], d)).toBe(3);
  });
});

describe("ludo bot — medium plays the obvious payoff", () => {
  test("takes a capture when one is available", () => {
    // red token 0 at step 5 with dice 3 lands on step 8 → track index 7.
    // Park a green token exactly there (7 is not a SAFE cell).
    const target = 7;
    expect(SAFE.has(target)).toBe(false);
    // green's step s maps to (START.green + s - 1) % 52 === target
    const greenStep = ((target - START.green + 52) % 52) + 1;
    const g = mkBoard({ red: [5, 30, 0, 0], green: [greenStep, 0, 0, 0] }, 3);
    expect(trackIndex("green", greenStep)).toBe(target);

    expect(chooseMove(g, "red", [0, 1], "medium")).toBe(0); // the capturing move
  });

  test("brings a token home on an exact roll", () => {
    // token 0 needs exactly 3 to finish (54 + 3 === 57).
    const g = mkBoard({ red: [54, 20, 0, 0] }, 3);
    expect(chooseMove(g, "red", [0, 1], "medium")).toBe(0);
  });

  test("prefers leaving the yard on a six over shuffling a token already out", () => {
    const g = mkBoard({ red: [0, 30, 0, 0] }, 6);
    expect(chooseMove(g, "red", [0, 1], "medium")).toBe(0);
  });
});

describe("ludo bot — hard weighs risk, medium does not", () => {
  test("hard avoids parking right in front of an enemy when a safe move exists", () => {
    // Option A (token 0): lands on a plain cell with an enemy 2 behind it.
    // Option B (token 1): lands in the home column — untouchable.
    const landingTi = 20; // plain cell (not in SAFE)
    expect(SAFE.has(landingTi)).toBe(false);
    const redStepToLand = ((landingTi - START.red + 52) % 52) + 1; // after moving
    const dice = 2;
    const redStart = redStepToLand - dice;

    // Enemy sits 2 cells behind the landing square → can capture next turn.
    const threatTi = (landingTi - 2 + 52) % 52;
    const greenStep = ((threatTi - START.green + 52) % 52) + 1;

    const g = mkBoard({ red: [redStart, 53, 0, 0], green: [greenStep, 0, 0, 0] }, dice);
    expect(trackIndex("red", redStart + dice)).toBe(landingTi);

    // 53 + 2 = 55 → inside the home column, zero risk.
    expect(chooseMove(g, "red", [0, 1], "hard")).toBe(1);
  });

  test("medium takes the greedier move; hard rejects it because it is exposed", () => {
    // Token 0 advances further (greedy wins on raw progress) but lands 3 cells
    // in front of an enemy. Token 1 advances less and lands somewhere safe.
    const dice = 5;
    const land0 = 50, land1 = 30; // red steps after moving
    const ti0 = trackIndex("red", land0);
    const ti1 = trackIndex("red", land1);
    expect(SAFE.has(ti0)).toBe(false);
    expect(SAFE.has(ti1)).toBe(false);

    // Enemy sitting 3 cells behind token 0's landing square.
    const threatTi = (ti0 - 3 + 52) % 52;
    const greenStep = ((threatTi - START.green + 52) % 52) + 1;
    expect(trackIndex("green", greenStep)).toBe(threatTi);

    const g = mkBoard({ red: [land0 - dice, land1 - dice, 0, 0], green: [greenStep, 0, 0, 0] }, dice);

    expect(chooseMove(g, "red", [0, 1], "medium")).toBe(0); // ignores the risk
    expect(chooseMove(g, "red", [0, 1], "hard")).toBe(1); // sees it and declines
  });
});

describe("ludo bot — plumbing", () => {
  test("easy is genuinely random across repeated identical positions", () => {
    const picks = new Set();
    for (let i = 0; i < 60; i++) {
      const g = mkBoard({ red: [10, 20, 30, 40] }, 2);
      picks.add(chooseMove(g, "red", [0, 1, 2, 3], "easy"));
    }
    expect(picks.size).toBeGreaterThan(1); // not deterministic like medium/hard
  });

  test("medium is deterministic for the same position", () => {
    const run = () => chooseMove(mkBoard({ red: [10, 20, 30, 40] }, 2), "red", [0, 1, 2, 3], "medium");
    const first = run();
    for (let i = 0; i < 10; i++) expect(run()).toBe(first);
  });

  test("bot seats are labelled and flagged", () => {
    const seat = botSeat("red", "hard");
    expect(seat.isBot).toBe(true);
    expect(seat.id).toBe("bot:red");
    expect(seat.difficulty).toBe("hard");
    expect(seat.name).toMatch(/Hard/);
  });

  test("harder bots think faster, and unknown difficulty falls back safely", () => {
    expect(delaysFor("hard").roll).toBeLessThan(delaysFor("easy").roll);
    expect(delaysFor("nonsense")).toBe(BOT_DELAYS.medium);
    for (const d of DIFFICULTIES) expect(BOT_DELAYS[d]).toBeDefined();
  });
});
