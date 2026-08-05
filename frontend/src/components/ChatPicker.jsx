import { useEffect, useMemo, useRef, useState } from "react";
import {
  EMOJI_CATEGORIES,
  searchEmoji,
  getRecentEmoji,
  pushRecentEmoji,
} from "@/lib/emoji.js";
import {
  klipyEnabled,
  searchGifs,
  trendingGifs,
  fallbackTrending,
  providerLabel,
} from "@/lib/gifs.js";
import { STICKERS } from "@/components/stickers/Stickers.jsx";

/**
 * 😊 The chat composer's expression picker — one popover, three tabs:
 *   Emoji    → inserts a glyph into the draft (message keeps being text)
 *   GIF      → sends immediately as a `gif` attachment (Tenor CDN url)
 *   Stickers → sends immediately as a `sticker` attachment (vector art, no url)
 *
 * GIFs and stickers send on click rather than staging into the draft because
 * that's the interaction every chat app trained users on — you pick a GIF, the
 * GIF is sent. Emoji are text, so they behave like text.
 */
export default function ChatPicker({ onInsertEmoji, onSendAttachment, disabled }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("emoji");
  const panelRef = useRef(null);

  // Click-outside / Escape to close — a picker that traps you is worse than no
  // picker. Only bound while open.
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (!panelRef.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const TABS = [
    ["emoji", "😊", "Emoji"],
    ["gif", "GIF", "GIFs"],
    ["sticker", "🎨", "Stickers"],
  ];

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        title="Emoji, GIFs & stickers"
        className={`w-8 h-8 rounded-lg text-lg leading-none transition-colors disabled:opacity-40 ${
          open ? "bg-white/10" : "hover:bg-white/5"
        }`}
      >
        😊
      </button>

      {open && (
        <div className="absolute bottom-full mb-2 left-0 z-50 w-[330px] sm:w-[360px] rounded-xl border border-gray-700 bg-gray-900/97 backdrop-blur shadow-2xl overflow-hidden">
          {/* tab strip */}
          <div className="flex items-center gap-1 p-1.5 border-b border-gray-800">
            {TABS.map(([id, icon, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={`flex-1 px-2 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  tab === id
                    ? "bg-brand-600/25 text-brand-200 ring-1 ring-brand-500/40"
                    : "text-gray-400 hover:text-white hover:bg-white/5"
                }`}
              >
                <span className="mr-1">{icon}</span>
                {label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="w-7 h-7 rounded-lg text-gray-500 hover:text-gray-200 hover:bg-white/5 text-xs"
            >
              ✕
            </button>
          </div>

          {tab === "emoji" && <EmojiTab onPick={onInsertEmoji} />}
          {tab === "gif" && (
            <GifTab
              onPick={(gif) => {
                // Built-ins travel as an ID (the art lives in the client
                // registry); real Tenor GIFs travel as their CDN url.
                onSendAttachment(
                  gif.local
                    ? { kind: "gif", gifId: gif.id, name: gif.name }
                    : { kind: "gif", url: gif.url, name: gif.name, width: gif.width, height: gif.height }
                );
                setOpen(false);
              }}
            />
          )}
          {tab === "sticker" && (
            <StickerTab
              onPick={(stickerId) => {
                onSendAttachment({ kind: "sticker", stickerId });
                setOpen(false);
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ── Emoji ──────────────────────────────────────────────────────────────────

function EmojiTab({ onPick }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState(EMOJI_CATEGORIES[0].id);
  const [recent, setRecent] = useState(getRecentEmoji);

  const results = useMemo(() => (query.trim() ? searchEmoji(query) : null), [query]);
  const active = EMOJI_CATEGORIES.find((c) => c.id === category) || EMOJI_CATEGORIES[0];

  function pick(glyph) {
    setRecent(pushRecentEmoji(glyph));
    onPick(glyph);
  }

  const Grid = ({ glyphs }) => (
    <div className="grid grid-cols-8 gap-0.5">
      {glyphs.map((g, i) => (
        <button
          key={`${g}-${i}`}
          type="button"
          onClick={() => pick(g)}
          className="h-8 rounded-md hover:bg-white/10 text-xl leading-none transition-transform hover:scale-125"
        >
          {g}
        </button>
      ))}
    </div>
  );

  return (
    <div>
      <div className="p-2 pb-1">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search emoji…"
          className="w-full px-2.5 py-1.5 rounded-lg bg-gray-950 border border-gray-700 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-brand-500"
        />
      </div>

      <div className="h-[248px] overflow-y-auto px-2 pb-2">
        {results ? (
          results.length ? (
            <Grid glyphs={results} />
          ) : (
            <p className="text-center text-xs text-gray-600 mt-16">No emoji for “{query}”</p>
          )
        ) : (
          <>
            {recent.length > 0 && (
              <>
                <p className="text-[10px] uppercase tracking-wide text-gray-500 mb-1 mt-1">Recent</p>
                <Grid glyphs={recent} />
                <p className="text-[10px] uppercase tracking-wide text-gray-500 mb-1 mt-3">
                  {active.label}
                </p>
              </>
            )}
            <Grid glyphs={active.emoji.map(([g]) => g)} />
          </>
        )}
      </div>

      {!results && (
        <div className="flex items-center gap-0.5 px-1.5 py-1 border-t border-gray-800 overflow-x-auto">
          {EMOJI_CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setCategory(c.id)}
              title={c.label}
              className={`shrink-0 w-8 h-7 rounded-md text-base leading-none transition-colors ${
                category === c.id ? "bg-brand-600/30" : "hover:bg-white/5 opacity-60 hover:opacity-100"
              }`}
            >
              {c.icon}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── GIFs ───────────────────────────────────────────────────────────────────

function GifTab({ onPick }) {
  const [query, setQuery] = useState("");
  const [gifs, setGifs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [noMatch, setNoMatch] = useState(false); // searched, but nothing matched
  // Bumping this re-runs the effect — that's the "shuffle" button, and it also
  // re-randomises the built-ins every time the tab is opened.
  const [nonce, setNonce] = useState(0);

  // Debounced search; `cancelled` guards the classic async race where a slow
  // early request resolves after a fast later one and overwrites it.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setNoMatch(false);

    // lib/gifs.js already cascades Klipy → OtakuGIFs → built-ins internally and
    // never throws, so this only has to handle "came back empty".
    const run = async () => {
      const q = query.trim();
      try {
        const results = q ? await searchGifs(q) : await trendingGifs();
        if (cancelled) return;
        if (results.length === 0) {
          // Never leave the user staring at an empty panel: say nothing
          // matched AND still show something pickable.
          setNoMatch(true);
          setGifs(fallbackTrending());
        } else {
          setGifs(results);
        }
      } catch {
        if (!cancelled) {
          setError("GIF service unreachable");
          setGifs(fallbackTrending());
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    const t = setTimeout(run, query.trim() ? 350 : 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, nonce]);

  return (
    <div>
      <div className="p-2 pb-1 flex gap-1.5">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={klipyEnabled() ? "Search GIFs…" : "Search reactions…"}
          className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg bg-gray-950 border border-gray-700 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-brand-500"
        />
        <button
          type="button"
          onClick={() => setNonce((n) => n + 1)}
          title="Shuffle — show me something else"
          className="shrink-0 w-9 rounded-lg border border-gray-700 text-gray-400 hover:text-white hover:border-brand-500 transition-colors text-sm"
        >
          🎲
        </button>
      </div>

      <div className="h-[248px] overflow-y-auto px-2 pb-2">
        {loading && (
          <div className="flex items-center justify-center h-full">
            <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
        {!loading && noMatch && (
          <p className="text-[11px] text-amber-300/90 py-1.5 px-1">
            Nothing for “{query}” — here are some favourites instead
          </p>
        )}
        {!loading && gifs.length > 0 && (
          // Masonry-ish two columns so GIFs of different aspect ratios pack
          // tightly instead of leaving gaps in a rigid grid.
          <div className="columns-2 gap-1.5 [column-fill:_balance]">
            {gifs.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => onPick(g)}
                className="mb-1.5 w-full block rounded-lg overflow-hidden border border-transparent hover:border-brand-500 transition-colors"
              >
                <img src={g.previewUrl} alt={g.name} loading="lazy" className="w-full block" />
              </button>
            ))}
          </div>
        )}
      </div>

      <p className="px-2.5 py-1 border-t border-gray-800 text-[10px] text-gray-600">
        {error ? `⚠️ ${error} — showing built-ins` : providerLabel(gifs)}
      </p>
    </div>
  );
}

// ── Stickers ───────────────────────────────────────────────────────────────

function StickerTab({ onPick }) {
  return (
    <div>
      <div className="h-[248px] overflow-y-auto p-3">
        <p className="text-[10px] uppercase tracking-wide text-gray-500 mb-2">Animated stickers</p>
        <div className="grid grid-cols-3 gap-2">
          {Object.entries(STICKERS).map(([kind, s]) => (
            <button
              key={kind}
              type="button"
              onClick={() => onPick(kind)}
              title={s.label}
              className="flex flex-col items-center gap-0.5 rounded-xl border border-gray-800 hover:border-brand-500 bg-gray-950/50 p-2 transition-all hover:scale-105"
            >
              <s.Comp size={56} />
              <span className="text-[10px] text-gray-400">{s.label}</span>
            </button>
          ))}
        </div>
      </div>
      <p className="px-2.5 py-1 border-t border-gray-800 text-[10px] text-gray-600">
        Vector art — animates at any size, nothing to download.
      </p>
    </div>
  );
}
