import { useEffect, useState } from "react";
import { STICKERS } from "@/components/stickers/Stickers.jsx";
import { LOCAL_GIFS } from "@/lib/localGifs.js";

// Built-in reaction GIFs are stored by id — resolve the art from the registry.
const localGifById = (id) => LOCAL_GIFS.find((g) => g.id === id);

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

export default function ChatAttachments({ attachments = [] }) {
  const [lightbox, setLightbox] = useState(null);
  if (!attachments.length) return null;

  // Several photos in one message tile into a grid; a lone one gets to be big.
  const images = attachments.filter((a) => a.kind === "image");
  const gridCols = images.length > 1 ? "grid-cols-2" : "grid-cols-1";

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
          if (a.kind === "image") return null; // handled above

          if (a.kind === "sticker") {
            const S = STICKERS[a.stickerId];
            if (!S) return null;
            return (
              <div key={`stk-${i}`} title={S.label}>
                <S.Comp size={104} />
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
