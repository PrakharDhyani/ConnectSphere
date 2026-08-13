/**
 * Built-in animated reaction "GIFs" — no network, no API key, no dead links.
 *
 * WHY THIS EXISTS: every GIF provider now requires an API key (Tenor's
 * keyless v1 endpoint returns 401, Giphy's old public beta key 403s), so with
 * no key configured there is NOTHING remote we can legitimately fetch. The
 * first attempt at a fallback hardcoded Tenor CDN urls — every one of them
 * 404'd, because a CDN id you didn't get from the API is a guess. Lesson:
 * a fallback that depends on an unverifiable external URL isn't a fallback.
 *
 * These are animated SVGs inlined as data URIs: they animate via SMIL/CSS
 * keyframes inside the document, scale crisply at any size, weigh a few
 * hundred bytes each, and can never 404. Same reasoning as the sticker set —
 * vector code beats binary assets when you control the art.
 *
 * When VITE_TENOR_KEY IS set, real Tenor search takes over and these become
 * the "Built-in" shelf shown alongside it.
 */

// Wrap raw SVG markup into a data URI usable as an <img src>. encodeURIComponent
// (not base64) keeps it readable in devtools and avoids a btoa unicode trap.
const svg = (markup) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 150" width="200" height="150">${markup}</svg>`
  )}`;

const bg = (from, to) => `
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%" stop-color="${from}"/><stop offset="100%" stop-color="${to}"/>
  </linearGradient></defs>
  <rect width="200" height="150" fill="url(#g)"/>`;

const caption = (text, color = "#fff") =>
  `<text x="100" y="136" text-anchor="middle" font-family="Inter,system-ui,sans-serif"
     font-size="15" font-weight="800" fill="${color}">${text}</text>`;

/** A bouncing emoji glyph with a caption — the workhorse template. */
const bouncer = (glyph, text, from, to, { dur = "1s", rotate = 0 } = {}) =>
  svg(`
    ${bg(from, to)}
    <g>
      <animateTransform attributeName="transform" type="translate"
        values="0,0; 0,-14; 0,0" dur="${dur}" repeatCount="indefinite"
        calcMode="spline" keySplines="0.4 0 0.2 1; 0.4 0 0.2 1" keyTimes="0;0.5;1"/>
      <text x="100" y="78" text-anchor="middle" font-size="62">${glyph}
        ${rotate ? `<animateTransform attributeName="transform" type="rotate"
          values="-${rotate} 100 62; ${rotate} 100 62; -${rotate} 100 62"
          dur="${dur}" repeatCount="indefinite"/>` : ""}
      </text>
    </g>
    ${caption(text)}`);

/** A glyph that pulses in scale — for hearts / fire / hype. */
const pulser = (glyph, text, from, to, dur = "0.9s") =>
  svg(`
    ${bg(from, to)}
    <text x="100" y="80" text-anchor="middle" font-size="62">${glyph}
      <animateTransform attributeName="transform" type="scale"
        values="1;1.25;1" dur="${dur}" repeatCount="indefinite"
        additive="sum" />
      <animateTransform attributeName="transform" type="translate"
        values="0,0" dur="${dur}" repeatCount="indefinite" additive="sum"/>
    </text>
    ${caption(text)}`);

/** Confetti rain — several falling squares on a gradient. */
const confetti = () => {
  const colors = ["#f472b6", "#facc15", "#4ade80", "#60a5fa", "#c084fc", "#fb923c"];
  const bits = colors
    .map((c, i) => {
      const x = 16 + i * 30;
      const delay = (i * 0.18).toFixed(2);
      return `<rect x="${x}" y="-12" width="9" height="14" rx="2" fill="${c}" opacity="0.95">
        <animate attributeName="y" values="-12;150" dur="1.6s" begin="${delay}s" repeatCount="indefinite"/>
        <animateTransform attributeName="transform" type="rotate"
          values="0 ${x + 4} 0; 220 ${x + 4} 80" dur="1.6s" begin="${delay}s" repeatCount="indefinite"/>
      </rect>`;
    })
    .join("");
  return svg(`
    ${bg("#4c1d95", "#7c3aed")}
    ${bits}
    <text x="100" y="80" text-anchor="middle" font-size="46">🎉</text>
    ${caption("PARTY!")}`);
};

/** Typing dots — the "one sec…" reaction. */
const typingDots = () =>
  svg(`
    ${bg("#111827", "#374151")}
    ${[0, 1, 2]
      .map(
        (i) => `<circle cx="${72 + i * 28}" cy="66" r="10" fill="#e5e7eb">
          <animate attributeName="cy" values="66;50;66" dur="0.9s"
            begin="${i * 0.15}s" repeatCount="indefinite"/>
          <animate attributeName="opacity" values="0.45;1;0.45" dur="0.9s"
            begin="${i * 0.15}s" repeatCount="indefinite"/>
        </circle>`
      )
      .join("")}
    ${caption("typing…", "#e5e7eb")}`);

/**
 * The built-in shelf. `name` doubles as the search index, so keywords matter
 * as much as the art — a search for "yes", "agree" or "ok" should all land on
 * the thumbs-up.
 */
export const LOCAL_GIFS = [
  { id: "lg-yes",     name: "yes thumbs up approve agree ok good like nice",     url: bouncer("👍", "YES!", "#065f46", "#10b981") },
  { id: "lg-no",      name: "no nope thumbs down disagree bad reject",           url: bouncer("👎", "NOPE", "#7f1d1d", "#ef4444") },
  { id: "lg-lol",     name: "lol laugh haha funny joke hilarious rofl",          url: bouncer("😂", "LOL", "#78350f", "#f59e0b", { rotate: 10 }) },
  { id: "lg-love",    name: "love heart adore like cute",                        url: pulser("❤️", "LOVE IT", "#831843", "#ec4899") },
  { id: "lg-fire",    name: "fire lit hot amazing awesome flames",               url: pulser("🔥", "FIRE", "#7c2d12", "#f97316", "0.7s") },
  { id: "lg-party",   name: "party celebrate confetti congrats yay woohoo",      url: confetti() },
  { id: "lg-clap",    name: "clap applause bravo well done nice congrats",       url: bouncer("👏", "BRAVO", "#1e3a8a", "#3b82f6", { dur: "0.6s" }) },
  { id: "lg-mind",    name: "mind blown wow amazing shocked woah whoa",          url: pulser("🤯", "WHOA", "#1e1b4b", "#6366f1") },
  { id: "lg-cry",     name: "cry sad tears upset crying sob",                    url: bouncer("😭", "SO SAD", "#0c4a6e", "#0ea5e9", { dur: "1.3s" }) },
  { id: "lg-shrug",   name: "shrug dunno idk whatever no idea",                  url: bouncer("🤷", "IDK", "#3f3f46", "#71717a", { dur: "1.4s" }) },
  { id: "lg-think",   name: "thinking hmm think consider maybe",                 url: bouncer("🤔", "HMM…", "#365314", "#84cc16", { dur: "1.5s" }) },
  { id: "lg-wave",    name: "hi hello wave hey greetings sup",                   url: bouncer("👋", "HEY!", "#155e75", "#06b6d4", { rotate: 18, dur: "0.7s" }) },
  { id: "lg-gg",      name: "gg good game gaming win victory ez",                url: bouncer("🎮", "GG!", "#4a044e", "#a21caf") },
  { id: "lg-letsgo",  name: "lets go hype excited pumped ready energy",          url: pulser("🚀", "LET'S GO", "#0f172a", "#8b5cf6", "0.6s") },
  { id: "lg-popcorn", name: "popcorn drama watching tea gossip movie",           url: bouncer("🍿", "👀 DRAMA", "#7c2d12", "#eab308", { dur: "1.2s" }) },
  { id: "lg-sleep",   name: "sleep tired sleepy bored zzz night goodnight",      url: bouncer("😴", "ZZZ…", "#1e293b", "#475569", { dur: "2s" }) },
  { id: "lg-typing",  name: "typing wait one sec hold on brb loading",           url: typingDots() },
  { id: "lg-100",     name: "100 perfect score facts truth agreed real",         url: pulser("💯", "FACTS", "#450a0a", "#dc2626", "0.8s") },
  { id: "lg-bday",    name: "happy birthday cake bday congratulations celebrate", url: bouncer("🎂", "HBD! 🎉", "#701a75", "#d946ef") },
  { id: "lg-thanks",  name: "thanks thank you ty grateful appreciate please",     url: bouncer("🙏", "THANK YOU", "#134e4a", "#14b8a6", { dur: "1.2s" }) },
  { id: "lg-sorry",   name: "sorry apologies oops my bad forgive",                url: bouncer("😅", "MY BAD", "#78350f", "#d97706", { dur: "1.1s" }) },
  { id: "lg-cool",    name: "cool nice awesome sweet dope swag",                  url: bouncer("😎", "COOL", "#0c4a6e", "#0284c7", { dur: "0.9s" }) },
  { id: "lg-scared",  name: "scared fear omg panic yikes oh no",                  url: bouncer("😱", "OH NO!", "#312e81", "#4f46e5", { dur: "0.5s", rotate: 8 }) },
  { id: "lg-eyes",    name: "eyes looking watching suspicious sus interesting",   url: bouncer("👀", "👀", "#1c1917", "#57534e", { dur: "0.8s" }) },
];

/**
 * Deterministic-per-call shuffle so the "random" shelf feels alive between
 * opens. Fisher–Yates on a copy — never mutate the exported array.
 */
export function shuffled(list = LOCAL_GIFS) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Search the built-ins. Multi-word queries match if ANY word hits, so
 * "so funny" still finds the LOL card. Returns [] only when genuinely nothing
 * matches — the caller decides what to show then.
 */
export function searchLocalGifs(query) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return shuffled();
  const scored = LOCAL_GIFS.map((g) => {
    let score = 0;
    for (const w of words) {
      if (g.name.includes(` ${w} `) || g.name.startsWith(`${w} `) || g.name.endsWith(` ${w}`)) score += 2;
      else if (g.name.includes(w)) score += 1;
    }
    return { g, score };
  }).filter((s) => s.score > 0);
  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.g);
}
