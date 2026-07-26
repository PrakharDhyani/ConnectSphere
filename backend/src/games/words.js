// Word bank for the draw-and-guess game — common, drawable nouns.
export const WORDS = [
  "apple", "banana", "car", "house", "tree", "sun", "moon", "star", "cat", "dog",
  "fish", "bird", "flower", "book", "chair", "table", "clock", "phone", "computer", "camera",
  "guitar", "piano", "drum", "balloon", "kite", "rocket", "airplane", "train", "bicycle", "boat",
  "umbrella", "glasses", "hat", "shoe", "sock", "shirt", "crown", "ring", "key", "lock",
  "bridge", "castle", "mountain", "river", "beach", "island", "volcano", "rainbow", "cloud", "snowman",
  "pizza", "burger", "ice cream", "cake", "donut", "coffee", "egg", "carrot", "mushroom", "cheese",
  "elephant", "lion", "tiger", "giraffe", "monkey", "penguin", "owl", "snake", "spider", "butterfly",
  "bee", "ladybug", "octopus", "whale", "dolphin", "shark", "crab", "turtle", "frog", "dinosaur",
  "robot", "ghost", "alien", "wizard", "pirate", "ninja", "clown", "king", "queen", "knight",
  "sword", "shield", "hammer", "axe", "ladder", "bucket", "broom", "candle", "lamp", "mirror",
  "scissors", "pencil", "brush", "magnet", "battery", "lightbulb", "gift", "map", "compass", "anchor",
  "tent", "campfire", "fence", "windmill", "lighthouse", "skateboard", "surfboard", "parachute", "telescope", "hourglass",
];

// Pick n distinct random words (index-varied — no Math.random ban here, this is app code).
export function pickWords(n) {
  const pool = [...WORDS];
  const out = [];
  for (let i = 0; i < n && pool.length; i++) {
    out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  }
  return out;
}

// Masked word for guessers: letters hidden as "_", spaces kept, revealed
// indices shown. Returns e.g. "_ p p _ _" for "apple" with index 1,2 revealed.
export function maskWord(word, revealed = new Set()) {
  return [...word]
    .map((ch, i) => (ch === " " ? " " : revealed.has(i) ? ch : "_"))
    .join(" ");
}

// Indices of real letters (not spaces) — used to reveal hint letters over time.
export function letterIndices(word) {
  const idx = [];
  [...word].forEach((ch, i) => ch !== " " && idx.push(i));
  return idx;
}
