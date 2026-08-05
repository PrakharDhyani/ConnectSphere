/**
 * GIF search — a three-layer source, best available wins.
 *
 *   1. KLIPY      full search, needs a free key (VITE_KLIPY_KEY)
 *   2. OTAKUGIFS  70 reaction categories, NO key, no signup
 *   3. BUILT-INS  24 generated animated SVG cards, no network at all
 *
 * WHY NOT TENOR (which this file used to target): Google is discontinuing the
 * Tenor API on 30 June 2026 and stopped issuing new keys on 13 Jan 2026 — you
 * literally cannot get a key any more. Klipy is the migration path the
 * ecosystem took (founded by ex-Tenor engineers, near-identical API shape,
 * free tier with no card, ads optional; WhatsApp migrated to it).
 *
 * Every layer degrades into the next, so the picker is never empty and never
 * shows a broken image. That rule exists because an earlier version fell back
 * to hardcoded Tenor CDN urls that all 404'd — a fallback must not depend on
 * an unverifiable external URL.
 *
 * We never re-host remote GIFs: the message stores the provider's CDN url, so
 * our storage bill for GIFs stays exactly zero.
 */
import { shuffled, searchLocalGifs } from "@/lib/localGifs.js";

// ── Layer 1: Klipy (keyed) ─────────────────────────────────────────────────

const KLIPY_KEY = import.meta.env.VITE_KLIPY_KEY || "";
// Klipy puts the key in the PATH, not a query param: /api/v1/<key>/gifs/...
const KLIPY_BASE = "https://api.klipy.com/api/v1";

export const klipyEnabled = () => Boolean(KLIPY_KEY);

/**
 * Klipy nests its media under a `files` object whose exact bucket names
 * (hd/md/sm × gif/webp/mp4) aren't publicly documented in a fetchable page —
 * their docs host blocks crawlers. Rather than hard-code a guess (the mistake
 * that produced the dead Tenor urls), walk the object and take the first
 * plausible still-image url, preferring smaller buckets for the grid preview
 * and larger ones for the sent GIF. Unknown shape → the item is skipped, never
 * rendered as a broken image.
 */
function pickKlipyFiles(files) {
  if (!files || typeof files !== "object") return null;
  const found = [];

  const visit = (node, sizeHint) => {
    if (!node || typeof node !== "object") return;
    // A leaf that looks like { url, width, height }
    if (typeof node.url === "string" && /^https?:\/\//.test(node.url)) {
      if (/\.(gif|webp)(\?|$)/i.test(node.url) || node.type === "gif") {
        found.push({
          url: node.url,
          width: Number(node.width) || undefined,
          height: Number(node.height) || undefined,
          size: sizeHint,
        });
      }
      return;
    }
    for (const [key, value] of Object.entries(node)) visit(value, sizeHint ?? key);
  };
  visit(files);
  if (!found.length) return null;

  const rank = { xs: 0, nano: 0, sm: 1, small: 1, tiny: 1, md: 2, medium: 2, hd: 3, lg: 3, large: 3 };
  const score = (f) => rank[String(f.size).toLowerCase()] ?? 2;
  const bySize = [...found].sort((a, b) => score(a) - score(b));
  return { preview: bySize[0], full: bySize[bySize.length - 1] };
}

function toKlipyGif(item) {
  const picked = pickKlipyFiles(item?.file || item?.files || item?.media);
  if (!picked) return null;
  return {
    id: String(item.id ?? item.slug ?? picked.full.url),
    previewUrl: picked.preview.url,
    url: picked.full.url,
    width: picked.full.width,
    height: picked.full.height,
    name: item.title || item.description || "GIF",
    provider: "klipy",
  };
}

async function klipy(path, params = {}) {
  const qs = new URLSearchParams({
    per_page: "24",
    // Klipy needs a stable per-user id for its recent/trending personalisation.
    customer_id: "connectsphere",
    content_filter: "medium", // family-friendly — this is a hangout, not 4chan
    ...params,
  });
  const res = await fetch(`${KLIPY_BASE}/${KLIPY_KEY}/gifs/${path}?${qs}`);
  if (!res.ok) throw new Error(`Klipy ${res.status}`);
  const body = await res.json();
  // Documented envelope is { result, data: { data: [...] } }, but be liberal.
  const items = body?.data?.data || body?.data || body?.results || [];
  return (Array.isArray(items) ? items : []).map(toKlipyGif).filter(Boolean);
}

// ── Layer 2: Otakugifs (keyless) ───────────────────────────────────────────

const OTAKU_BASE = "https://api.otakugifs.xyz/gif";

/**
 * Reaction categories Otakugifs serves, mapped to the words people actually
 * type in a chat search box. Verified live against /gif/allreactions (70
 * categories); this is the subset that reads as a chat reaction, with search
 * synonyms attached so "lol" finds `laugh` and "ok" finds `thumbsup`.
 */
const OTAKU_REACTIONS = [
  ["thumbsup", "thumbs up yes ok approve agree good nice"],
  ["laugh", "laugh lol haha funny hilarious rofl lmao"],
  ["clap", "clap applause bravo well done congrats"],
  ["celebrate", "celebrate party yay congrats woohoo hype"],
  ["cry", "cry sad tears crying sob upset"],
  ["facepalm", "facepalm oh no cringe smh"],
  ["shrug", "shrug dunno idk whatever no idea"],
  ["wave", "wave hi hello hey bye greetings"],
  ["hug", "hug hugs comfort love care"],
  ["love", "love heart adore like affection"],
  ["happy", "happy joy glad smile cheerful"],
  ["angrystare", "angry mad rage annoyed furious"],
  ["confused", "confused huh what puzzled lost"],
  ["scared", "scared fear afraid panic yikes"],
  ["surprised", "surprised shocked wow woah omg amazed"],
  ["smug", "smug smirk sly told you so"],
  ["shy", "shy blush embarrassed flustered"],
  ["sleep", "sleep sleepy tired zzz goodnight bored"],
  ["dance", "dance dancing party groove vibe"],
  ["huh", "huh think thinking hmm what wondering unsure"],
  ["pat", "pat headpat there there comfort"],
  ["cool", "cool awesome swag dope sunglasses"],
  ["yes", "yes yep agreed correct affirmative"],
  ["no", "no nope nah disagree reject"],
  ["sorry", "sorry apologize apologies my bad"],
  ["cheers", "cheers drink toast celebrate beer"],
  ["stare", "stare staring watching eyes suspicious sus"],
  ["yawn", "yawn bored tired boring"],
  ["punch", "punch hit fight attack"],
  ["run", "run running escape flee fast"],
  ["sing", "sing singing music karaoke song"],
  ["nervous", "nervous anxious worried sweat"],
  ["evillaugh", "evil laugh scheming plotting mischief"],
  ["brofist", "brofist fist bump respect nice teamwork"],
  ["headbang", "headbang rock metal music jam"],
  ["nom", "nom eating food hungry yum snack"],
  ["sip", "sip drink tea coffee sipping"],
  ["woah", "woah whoa impressive incredible unreal"],
  ["slowclap", "slow clap sarcastic bravo impressive"],
  ["poke", "poke nudge hey attention"],
  ["mad", "mad furious upset irritated"],
  ["sweat", "sweat nervous awkward uncomfortable"],
  ["roll", "roll rolling eyes whatever ugh"],
  ["cuddle", "cuddle snuggle cozy warm"],
  ["smile", "smile grin pleased content"],
  ["stop", "stop halt no wait dont"],
];

const OTAKU_INDEX = new Map(OTAKU_REACTIONS);

/** One random GIF for a reaction. Otakugifs returns a different one per call. */
async function otakuOne(reaction) {
  const res = await fetch(`${OTAKU_BASE}?reaction=${encodeURIComponent(reaction)}&format=gif`);
  if (!res.ok) throw new Error(`Otakugifs ${res.status}`);
  const { url } = await res.json();
  if (!url) return null;
  return {
    // The CDN filename is unique per GIF, so it doubles as a stable React key.
    id: `otaku-${reaction}-${url.split("/").pop()}`,
    previewUrl: url,
    url,
    name: reaction,
    provider: "otakugifs",
  };
}

/** Fetch `count` random GIFs across the given reactions, tolerating failures. */
async function otakuMany(reactions, count) {
  const picks = [];
  for (let i = 0; i < count; i++) picks.push(reactions[i % reactions.length]);
  const settled = await Promise.allSettled(picks.map(otakuOne));
  return settled
    .filter((s) => s.status === "fulfilled" && s.value)
    .map((s) => s.value);
}

export const otakuTrending = () => {
  const shuffledReactions = [...OTAKU_REACTIONS.map(([r]) => r)].sort(() => Math.random() - 0.5);
  return otakuMany(shuffledReactions, 18);
};

export async function otakuSearch(query) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return otakuTrending();

  // Score each reaction by keyword overlap; whole-word hits beat substrings.
  const scored = OTAKU_REACTIONS.map(([reaction, keywords]) => {
    let score = 0;
    for (const w of words) {
      if (reaction === w) score += 4;
      else if (keywords.includes(` ${w} `) || keywords.startsWith(`${w} `) || keywords.endsWith(` ${w}`)) score += 2;
      else if (keywords.includes(w)) score += 1;
    }
    return { reaction, score };
  })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) return [];
  // Several GIFs from the best match, fewer from runners-up — a search for
  // "laugh" should mostly be laughing, with some variety.
  const top = scored.slice(0, 4).map((s) => s.reaction);
  return otakuMany(top, Math.min(18, top.length * 5));
}

export const otakuHasMatch = (query) =>
  query.trim().toLowerCase().split(/\s+/).filter(Boolean).some((w) =>
    [...OTAKU_INDEX.entries()].some(([r, kw]) => r === w || kw.includes(w))
  );

// ── Layer 3: built-ins (offline) ───────────────────────────────────────────

/**
 * `previewUrl` and `url` are the SAME data URI — these are self-contained
 * animated SVGs, so there is no separate thumbnail to fetch. Tagged
 * `local: true` so the picker labels the shelf honestly and the sender knows
 * to transmit an id instead of a url.
 */
const asLocal = (g) => ({ ...g, previewUrl: g.url, width: 200, height: 150, local: true, provider: "builtin" });

export const fallbackTrending = () => shuffled().map(asLocal);
export const fallbackSearch = (query) => searchLocalGifs(query).map(asLocal);

// ── Public API used by the picker ──────────────────────────────────────────

/** True when SOME network provider is available (i.e. not built-ins only). */
export const gifSearchEnabled = () => true; // otakugifs needs no key

/**
 * Trending/featured shelf. Klipy → Otakugifs → built-ins.
 * Never throws: the built-in layer cannot fail.
 */
export async function trendingGifs() {
  if (klipyEnabled()) {
    try {
      const r = await klipy("trending");
      if (r.length) return r;
    } catch { /* fall through */ }
  }
  try {
    const r = await otakuTrending();
    if (r.length) return r;
  } catch { /* fall through */ }
  return fallbackTrending();
}

/**
 * Search. Klipy → Otakugifs → built-ins, and if everything comes back empty
 * the caller is told so it can show "nothing for X, here are favourites"
 * rather than a blank panel.
 */
export async function searchGifs(query) {
  if (klipyEnabled()) {
    try {
      const r = await klipy("search", { q: query });
      if (r.length) return r;
    } catch { /* fall through */ }
  }
  try {
    const r = await otakuSearch(query);
    if (r.length) return r;
  } catch { /* fall through */ }
  return fallbackSearch(query);
}

/** Which provider is actually powering the tab right now (for the footer). */
export function providerLabel(gifs = []) {
  if (gifs.some((g) => g.provider === "klipy")) return "Powered by KLIPY";
  if (gifs.some((g) => g.provider === "otakugifs")) return "Reaction GIFs by OtakuGIFs";
  return "Built-in reactions · add VITE_KLIPY_KEY for full GIF search";
}
