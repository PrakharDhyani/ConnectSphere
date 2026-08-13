import { useEffect, useRef, useState } from "react";
import { ALL_STICKERS, saveReceivedSticker } from "@/lib/stickerStore.js";
import { LOCAL_GIFS } from "@/lib/localGifs.js";
import { api } from "@/lib/api.js";
import { fmtDuration } from "@/hooks/useVoiceRecorder.js";

// Built-in reaction GIFs are stored by id — resolve the art from the registry.
const localGifById = (id) => LOCAL_GIFS.find((g) => g.id === id);

/**
 * 🎙️ Voice note bubble — real waveform (captured at record time and carried in
 * the message), scrub-to-seek, and a progress fill so you can see where you
 * are. Falls back to a flat bar if an older message has no waveform.
 */
function VoiceNote({ attachment }) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0); // 0..1
  const bars = attachment.waveform?.length ? attachment.waveform : Array(32).fill(28);
  const totalMs = attachment.durationMs || 0;

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onTime = () => {
      const d = el.duration && Number.isFinite(el.duration) ? el.duration : totalMs / 1000;
      setProgress(d ? el.currentTime / d : 0);
    };
    const onEnd = () => { setPlaying(false); setProgress(0); };
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("ended", onEnd);
    el.addEventListener("pause", () => setPlaying(false));
    el.addEventListener("play", () => setPlaying(true));
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("ended", onEnd);
    };
  }, [totalMs]);

  const toggle = () => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) el.play().catch(() => {});
    else el.pause();
  };

  const seek = (e) => {
    const el = audioRef.current;
    if (!el) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const d = el.duration && Number.isFinite(el.duration) ? el.duration : totalMs / 1000;
    if (d) { el.currentTime = ratio * d; setProgress(ratio); }
  };

  const elapsed = totalMs ? fmtDuration(progress * totalMs) : null;

  return (
    <div className="flex items-center gap-2.5 max-w-[320px] rounded-2xl border border-gray-700 bg-gray-950/60 px-3 py-2">
      <button
        type="button"
        onClick={toggle}
        className="w-9 h-9 shrink-0 rounded-full bg-gradient-to-br from-brand-500 to-fuchsia-600 text-white flex items-center justify-center hover:brightness-110"
        title={playing ? "Pause" : "Play"}
      >
        {playing ? "⏸" : "▶"}
      </button>

      <div className="flex items-end gap-[2px] h-8 flex-1 min-w-0 cursor-pointer" onClick={seek}>
        {bars.map((v, i) => {
          const played = i / bars.length <= progress;
          return (
            <span
              key={i}
              className={`flex-1 rounded-full transition-colors ${played ? "bg-brand-400" : "bg-gray-600"}`}
              style={{ height: `${Math.max(3, (v / 100) * 30)}px` }}
            />
          );
        })}
      </div>

      <span className="shrink-0 text-[10px] text-gray-400 tabular-nums w-9 text-right">
        {playing && elapsed ? elapsed : totalMs ? fmtDuration(totalMs) : "🎙️"}
      </span>
      <audio ref={audioRef} src={attachment.url} preload="metadata" className="hidden" />
    </div>
  );
}

/**
 * 👁️ View-once media. The url is NOT in the message — opening it calls the
 * server, which hands the url back exactly once and records the view. After
 * that the bubble shows "Opened" and there is nothing left to fetch.
 */
function ViewOnce({ attachment, roomId, messageId, index }) {
  const [url, setUrl] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const spent = attachment.spent || (!attachment.url && !url && attachment.viewedCount > 0);

  async function open() {
    if (busy || url) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.post(`/rooms/${roomId}/messages/${messageId}/view`, { index });
      setUrl(res.data.data.url);
    } catch (err) {
      setError(err.response?.status === 410 ? "Already opened" : "Could not open");
    } finally {
      setBusy(false);
    }
  }

  if (url) {
    return (
      <div className="relative max-w-[280px] rounded-xl overflow-hidden border border-amber-700/60">
        {attachment.kind === "video" ? (
          <video src={url} controls autoPlay className="w-full max-h-72 bg-black" />
        ) : (
          <img src={url} alt="" className="w-full" />
        )}
        <span className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-black/75 text-[9px] font-bold text-amber-300">
          👁️ VIEW ONCE
        </span>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={open}
      disabled={spent || busy}
      className={`flex items-center gap-2.5 max-w-[280px] rounded-xl border px-3 py-2.5 transition-colors ${
        spent
          ? "border-gray-800 bg-gray-950/40 cursor-default"
          : "border-amber-700/60 bg-amber-950/20 hover:border-amber-500"
      }`}
    >
      <span className="text-xl">{spent ? "🚫" : "👁️"}</span>
      <span className="text-left min-w-0">
        <span className={`block text-xs font-medium ${spent ? "text-gray-500" : "text-amber-200"}`}>
          {spent ? "Opened" : busy ? "Opening…" : `View once · ${attachment.kind === "video" ? "video" : "photo"}`}
        </span>
        <span className="block text-[10px] text-gray-500">
          {spent ? "This media is no longer available" : "Tap to view — you can only open it once"}
        </span>
      </span>
      {error && <span className="text-[10px] text-red-400">{error}</span>}
    </button>
  );
}

/**
 * Renders a message's attachments: images and GIFs as clickable thumbnails
 * (full-size in a lightbox), video/audio with native players, stickers as the
 * animated vector art, and anything else as a download chip.
 */

export const fmtBytes = (n) => {
  if (!Number.isFinite(n)) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};

const FILE_ICON = [
  [/pdf/, "📕"],
  [/zip|compressed/, "🗜️"],
  [/word|document/, "📘"],
  [/sheet|excel|csv/, "📗"],
  [/presentation|powerpoint/, "📙"],
  [/json|text|markdown/, "📄"],
];
const iconFor = (mime = "") => FILE_ICON.find(([re]) => re.test(mime))?.[1] ?? "📎";

/** Full-screen image/GIF viewer. Escape or a backdrop click closes it. */
function Lightbox({ src, alt, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden"; // don't scroll the chat behind it
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/85 backdrop-blur-sm flex items-center justify-center p-4 animate-[fadeIn_150ms_ease-out]"
      onClick={onClose}
    >
      <style>{`@keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }`}</style>
      <img
        src={src}
        alt={alt}
        onClick={(e) => e.stopPropagation()}
        className="max-w-full max-h-full rounded-lg shadow-2xl object-contain"
      />
      <div className="absolute top-4 right-4 flex gap-2">
        <a
          href={src}
          download
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm backdrop-blur"
        >
          ⬇ Download
        </a>
        <button
          onClick={onClose}
          className="w-9 h-9 rounded-lg bg-white/10 hover:bg-white/20 text-white backdrop-blur"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

export default function ChatAttachments({ attachments = [], roomId, messageId }) {
  const [lightbox, setLightbox] = useState(null);
  const [saved, setSaved] = useState(null); // sticker id/url just saved, for the toast
  if (!attachments.length) return null;

  // Ordinary photos tile into a grid; view-once ones and custom stickers get
  // their own treatment, and a lone photo gets to be big.
  const images = attachments.filter((a) => a.kind === "image" && !a.viewOnce && !a.isSticker);
  const gridCols = images.length > 1 ? "grid-cols-2" : "grid-cols-1";

  function save(attachment, key) {
    const result = saveReceivedSticker(attachment);
    if (result) {
      setSaved(key);
      setTimeout(() => setSaved(null), 1800);
    }
  }

  return (
    <>
      <div className="mt-1.5 space-y-1.5">
        {/* images (tiled) */}
        {images.length > 0 && (
          <div className={`grid ${gridCols} gap-1.5 max-w-md`}>
            {images.map((a, i) => (
              <button
                key={`img-${i}`}
                type="button"
                onClick={() => setLightbox({ src: a.url, alt: a.name || "image" })}
                className="group relative rounded-xl overflow-hidden border border-gray-700 hover:border-brand-500 transition-colors bg-gray-950"
              >
                <img
                  src={a.url}
                  alt={a.name || ""}
                  loading="lazy"
                  className={`w-full object-cover ${images.length > 1 ? "h-36" : "max-h-72"}`}
                />
                <span className="absolute inset-0 bg-black/0 group-hover:bg-black/15 transition-colors" />
              </button>
            ))}
          </div>
        )}

        {attachments.map((a, i) => {
          if (a.kind === "image" && !a.viewOnce && !a.isSticker) return null; // handled above

          // Custom sticker — sticker-sized, transparent, savable, never in the
          // photo grid.
          if (a.isSticker && a.kind === "image") {
            return (
              <div key={`cs-${i}`} className="group relative w-fit">
                <img src={a.url} alt={a.name || "sticker"} className="w-28 h-28 object-contain" loading="lazy" />
                <button
                  type="button"
                  onClick={() => save(a, `cs-${i}`)}
                  title="Save to my stickers"
                  className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-gray-900/90 border border-gray-700 text-[11px] opacity-0 group-hover:opacity-100 transition-opacity hover:border-brand-500"
                >
                  {saved === `cs-${i}` ? "✓" : "＋"}
                </button>
              </div>
            );
          }

          // View-once photo/video — server-gated, opened at most once.
          if (a.viewOnce && (a.kind === "image" || a.kind === "video")) {
            return (
              <ViewOnce key={`vo-${i}`} attachment={a} roomId={roomId} messageId={messageId} index={i} />
            );
          }

          // Voice note (recorded here) vs an ordinary uploaded audio file.
          if (a.kind === "audio" && a.voice) {
            return <VoiceNote key={`vn-${i}`} attachment={a} />;
          }

          if (a.kind === "sticker") {
            const S = ALL_STICKERS[a.stickerId];
            if (!S) return null;
            return (
              <div key={`stk-${i}`} className="group relative w-fit" title={S.label}>
                <S.Comp size={104} />
                {/* Save someone else's sticker into your own tray. */}
                <button
                  type="button"
                  onClick={() => save(a, `stk-${i}`)}
                  title="Save to my stickers"
                  className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-gray-900/90 border border-gray-700 text-[11px] opacity-0 group-hover:opacity-100 transition-opacity hover:border-brand-500"
                >
                  {saved === `stk-${i}` ? "✓" : "＋"}
                </button>
              </div>
            );
          }

          if (a.kind === "gif") {
            // Built-ins carry an id, not a url — resolve their art locally.
            const local = a.gifId ? localGifById(a.gifId) : null;
            if (a.gifId && !local) return null; // unknown id (older/newer client)
            const src = local ? local.url : a.url;
            if (!src) return null;
            return (
              <button
                key={`gif-${i}`}
                type="button"
                onClick={() => setLightbox({ src, alt: a.name || "GIF" })}
                className="block relative rounded-xl overflow-hidden border border-gray-700 hover:border-brand-500 transition-colors max-w-[260px]"
              >
                <img src={src} alt={a.name || "GIF"} loading="lazy" className="w-full block" />
                <span className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded bg-black/70 text-[9px] font-bold tracking-wide text-white">
                  GIF
                </span>
              </button>
            );
          }

          if (a.kind === "video") {
            return (
              <video
                key={`vid-${i}`}
                src={a.url}
                controls
                preload="metadata"
                className="rounded-xl border border-gray-700 max-w-md w-full max-h-72 bg-black"
              />
            );
          }

          if (a.kind === "audio") {
            return (
              <div key={`aud-${i}`} className="flex items-center gap-2 max-w-sm rounded-xl border border-gray-700 bg-gray-950/60 px-3 py-2">
                <span className="text-lg">🎵</span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-gray-300 truncate">{a.name || "Audio"}</p>
                  <audio src={a.url} controls className="w-full h-8 mt-1" />
                </div>
              </div>
            );
          }

          // generic file → download chip
          return (
            <a
              key={`file-${i}`}
              href={a.url}
              target="_blank"
              rel="noreferrer"
              download
              className="flex items-center gap-2.5 max-w-sm rounded-xl border border-gray-700 hover:border-brand-500 bg-gray-950/60 px-3 py-2 transition-colors group"
            >
              <span className="text-xl shrink-0">{iconFor(a.mime)}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-xs text-gray-200 truncate group-hover:text-brand-300">
                  {a.name || "File"}
                </span>
                <span className="block text-[10px] text-gray-500">{fmtBytes(a.size)}</span>
              </span>
              <span className="text-gray-500 group-hover:text-brand-400 shrink-0">⬇</span>
            </a>
          );
        })}
      </div>

      {lightbox && <Lightbox {...lightbox} onClose={() => setLightbox(null)} />}
    </>
  );
}
