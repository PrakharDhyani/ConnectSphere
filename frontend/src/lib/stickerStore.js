/**
 * The sticker catalogue: built-in packs + the user's saved/custom stickers.
 *
 * Three kinds of sticker exist, and they are stored very differently:
 *
 *  · BUILT-IN  — vector components in components/stickers/*.jsx, referenced by
 *                a short id. Nothing is uploaded; the art ships with the app.
 *  · CUSTOM    — made by the user from a photo (background removed on-device),
 *                uploaded to MinIO like any other chat image, referenced by url.
 *  · FAVOURITE — not a kind at all, just a pinned id/url in localStorage.
 *
 * Favourites and the custom-sticker index live in localStorage rather than the
 * database on purpose: they are per-person UI preferences, not shared room
 * state, and keeping them client-side means zero new endpoints and no
 * migration. The uploaded image itself IS durable (it is in object storage) —
 * only the "this is in my tray" pointer is local.
 */
import { STICKERS } from "@/components/stickers/Stickers.jsx";
import { STICKERS_2 } from "@/components/stickers/Stickers2.jsx";

/** All built-in stickers, both packs, as one registry. */
export const ALL_STICKERS = { ...STICKERS, ...STICKERS_2 };

export const STICKER_PACKS = [
  { id: "classic", label: "Classic", ids: Object.keys(STICKERS) },
  { id: "reactions", label: "Reactions", ids: Object.keys(STICKERS_2) },
];

const FAV_KEY = "groot:stickers:favourites";
const CUSTOM_KEY = "groot:stickers:custom";
const MAX_CUSTOM = 60;

const read = (key, fallback) => {
  try {
    const v = JSON.parse(localStorage.getItem(key) || "null");
    return Array.isArray(v) ? v : fallback;
  } catch {
    return fallback;
  }
};
const write = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode / quota — favourites are a nicety, never fail the UI */
  }
};

// ── Favourites (built-in sticker ids) ──────────────────────────────────────

export const getFavouriteStickers = () =>
  read(FAV_KEY, []).filter((id) => typeof id === "string" && ALL_STICKERS[id]);

export const isFavouriteSticker = (id) => getFavouriteStickers().includes(id);

/** Toggle and return the new list. */
export function toggleFavouriteSticker(id) {
  if (!ALL_STICKERS[id]) return getFavouriteStickers();
  const current = getFavouriteStickers();
  const next = current.includes(id) ? current.filter((x) => x !== id) : [id, ...current];
  write(FAV_KEY, next);
  return next;
}

// ── Custom stickers (uploaded, background-removed images) ──────────────────

/** [{ id, url, name, createdAt }] — newest first. */
export const getCustomStickers = () =>
  read(CUSTOM_KEY, []).filter((s) => s && typeof s.url === "string");

export function addCustomSticker({ url, name = "Sticker" }) {
  if (!url) return getCustomStickers();
  const entry = {
    // Not crypto-sensitive; just needs to be unique per tray entry.
    id: `cs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    url,
    name: String(name).slice(0, 40),
    createdAt: new Date().toISOString(),
  };
  const next = [entry, ...getCustomStickers()].slice(0, MAX_CUSTOM);
  write(CUSTOM_KEY, next);
  return next;
}

export function removeCustomSticker(id) {
  const next = getCustomStickers().filter((s) => s.id !== id);
  write(CUSTOM_KEY, next);
  return next;
}

/**
 * Save a sticker someone ELSE sent into your own tray — the WhatsApp
 * "add to favourites" gesture. Built-ins become favourites; uploaded ones are
 * copied into the custom tray by url (the file already lives in our storage,
 * so there is nothing to re-upload).
 */
export function saveReceivedSticker(attachment) {
  if (!attachment) return;
  if (attachment.stickerId && ALL_STICKERS[attachment.stickerId]) {
    if (!isFavouriteSticker(attachment.stickerId)) toggleFavouriteSticker(attachment.stickerId);
    return "favourite";
  }
  if (attachment.url) {
    const already = getCustomStickers().some((s) => s.url === attachment.url);
    if (!already) addCustomSticker({ url: attachment.url, name: attachment.name || "Saved" });
    return already ? "already" : "custom";
  }
  return null;
}
