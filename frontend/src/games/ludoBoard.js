/**
 * Ludo board GEOMETRY for rendering on a 15×15 grid ([row, col], 0..14).
 * Mirrors the server's step model (0 yard, 1..51 track, 52..56 home, 57 center).
 */
export const COLORS = ["red", "green", "yellow", "blue"];
export const START = { red: 0, green: 13, yellow: 26, blue: 39 };
export const SAFE = new Set([0, 8, 13, 21, 26, 34, 39, 47]);

export const COLOR_HEX = {
  red: "#e03131",
  green: "#2f9e44",
  yellow: "#f2b705",
  blue: "#1971c2",
};
export const COLOR_SOFT = {
  red: "rgba(224,49,49,0.18)",
  green: "rgba(47,158,68,0.18)",
  yellow: "rgba(242,183,5,0.18)",
  blue: "rgba(25,113,194,0.18)",
};

// The 52 shared-track cells, clockwise, starting at red's entry.
export const TRACK = [
  [6, 1], [6, 2], [6, 3], [6, 4], [6, 5],
  [5, 6], [4, 6], [3, 6], [2, 6], [1, 6], [0, 6],
  [0, 7],
  [0, 8], [1, 8], [2, 8], [3, 8], [4, 8], [5, 8],
  [6, 9], [6, 10], [6, 11], [6, 12], [6, 13], [6, 14],
  [7, 14],
  [8, 14], [8, 13], [8, 12], [8, 11], [8, 10], [8, 9],
  [9, 8], [10, 8], [11, 8], [12, 8], [13, 8], [14, 8],
  [14, 7],
  [14, 6], [13, 6], [12, 6], [11, 6], [10, 6], [9, 6],
  [8, 5], [8, 4], [8, 3], [8, 2], [8, 1], [8, 0],
  [7, 0],
  [6, 0],
];

export const HOME = {
  red: [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5]],
  green: [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7]],
  yellow: [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9]],
  blue: [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7]],
};

export const YARD = {
  red: [[1, 1], [1, 4], [4, 1], [4, 4]],
  green: [[1, 10], [1, 13], [4, 10], [4, 13]],
  yellow: [[10, 10], [10, 13], [13, 10], [13, 13]],
  blue: [[10, 1], [10, 4], [13, 1], [13, 4]],
};

export const CENTER = [7, 7];

// Where token #tokenIdx of `color` sits at `step`.
export function coord(color, step, tokenIdx) {
  if (step <= 0) return YARD[color][tokenIdx];
  if (step <= 51) return TRACK[(START[color] + step - 1) % 52];
  if (step <= 56) return HOME[color][step - 52];
  return CENTER;
}

// ── precomputed per-cell info for painting the board ──
const k = (r, c) => `${r},${c}`;
const trackAt = new Map(TRACK.map(([r, c], i) => [k(r, c), i]));
const homeAt = new Map();
for (const color of COLORS) HOME[color].forEach(([r, c]) => homeAt.set(k(r, c), color));
const startAt = new Map();
for (const color of COLORS) { const [r, c] = TRACK[START[color]]; startAt.set(k(r, c), color); }
const safeCoords = new Set([...SAFE].map((i) => k(TRACK[i][0], TRACK[i][1])));

function baseColor(r, c) {
  if (r < 6 && c < 6) return "red";
  if (r < 6 && c > 8) return "green";
  if (r > 8 && c > 8) return "yellow";
  if (r > 8 && c < 6) return "blue";
  return null;
}

export function cellInfo(r, c) {
  const key = k(r, c);
  if (homeAt.has(key)) return { type: "home", color: homeAt.get(key) };
  if (startAt.has(key)) return { type: "start", color: startAt.get(key), safe: true };
  if (trackAt.has(key)) return { type: "track", safe: safeCoords.has(key) };
  const b = baseColor(r, c);
  if (b) return { type: "base", color: b };
  if (r >= 6 && r <= 8 && c >= 6 && c <= 8) return { type: "center" };
  return { type: "empty" };
}
