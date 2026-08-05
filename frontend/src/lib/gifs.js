/**
 * GIF search via Tenor's public API (Google) — free tier, no billing account.
 *
 * Why Tenor over Giphy: Giphy's free key is explicitly "development only" and
 * they gate production behind a paid plan; Tenor's free tier permits real use
 * with attribution. Either way the key is a PUBLIC client key by design (it's
 * in the browser), which is why it lives in VITE_TENOR_KEY and is scoped to
 * GIF search only.
 *
 * Free-tier rule: if no key is configured the picker still works — it falls
 * back to the BUILT-IN animated set (lib/localGifs.js), which needs no network
 * at all. An earlier version fell back to hardcoded Tenor CDN urls; every one
 * of them 404'd, because a CDN id you didn't receive from the API is a guess.
 * A fallback must not depend on an unverifiable external URL.
 *
 * We never re-host real GIFs: the message stores the Tenor CDN url, so our
 * storage bill stays zero and their CDN does the delivery.
 */

import { shuffled, searchLocalGifs } from "@/lib/localGifs.js";

const KEY = import.meta.env.VITE_TENOR_KEY || "";
const BASE = "https://tenor.googleapis.com/v2";
// Tenor asks integrators to send a stable client id for rate-limit accounting.
const CLIENT = "connectsphere";

export const gifSearchEnabled = () => Boolean(KEY);

/**
 * Tenor's response → the shape our UI and Message model use.
 * `tinygif` is the grid thumbnail (small, fast); `gif` is what gets sent.
 */
function toGif(result) {
  const media = result.media_formats || {};
  const full = media.gif || media.mediumgif || media.tinygif;
  const preview = media.tinygif || media.nanogif || full;
  if (!full?.url) return null;
  return {
    id: result.id,
    previewUrl: preview.url,
    url: full.url,
    width: full.dims?.[0],
    height: full.dims?.[1],
    name: result.content_description || "GIF",
  };
}

async function tenor(path, params) {
  const qs = new URLSearchParams({
    key: KEY,
    client_key: CLIENT,
    media_filter: "gif,mediumgif,tinygif,nanogif",
    limit: "24",
    contentfilter: "medium", // family-friendly — this is a hangout, not 4chan
    ...params,
  });
  const res = await fetch(`${BASE}/${path}?${qs}`);
  if (!res.ok) throw new Error(`Tenor ${res.status}`);
  const data = await res.json();
  return (data.results || []).map(toGif).filter(Boolean);
}

export const searchGifs = (query) => tenor("search", { q: query });
export const trendingGifs = () => tenor("featured", {});

/**
 * Built-in fallback. `previewUrl` and `url` are the SAME data URI — these are
 * self-contained animated SVGs, so there's no separate thumbnail to fetch.
 * They're tagged `local: true` so the picker can label the shelf honestly.
 */
const asGif = (g) => ({ ...g, previewUrl: g.url, width: 200, height: 150, local: true });

export const fallbackTrending = () => shuffled().map(asGif);
export const fallbackSearch = (query) => searchLocalGifs(query).map(asGif);
