/**
 * Ludo board LOGIC (no coordinates — the client owns rendering).
 *
 * Token position = a `step` 0..57:
 *   0        → in the yard (base)
 *   1..51    → on the shared 52-cell track (relative to the color's start)
 *   52..56   → the color's private 5-cell home column
 *   57       → finished (center)
 *
 * A token needs an EXACT roll to land on 57 (can't overshoot).
 */
export const COLORS = ["red", "green", "yellow", "blue"];

// Where each color enters the shared track (cells are 13 apart).
export const START = { red: 0, green: 13, yellow: 26, blue: 39 };

// Shared-track indices that can't be captured on (the 4 start cells + 4 stars).
export const SAFE = new Set([0, 8, 13, 21, 26, 34, 39, 47]);

export const TRACK_LEN = 52;
export const FINISH = 57;

// The shared-track cell a token occupies at `step`, or -1 if it's in the yard /
// home column / finished (i.e. not capture-able and can't capture).
export function trackIndex(color, step) {
  if (step < 1 || step > 51) return -1;
  return (START[color] + step - 1) % TRACK_LEN;
}
