import { useRef, useState } from "react";
import { BG_EFFECTS } from "@/lib/bgFilter.js";

// CSS approximations of the procedural scenes in lib/bgFilter.js — the swatch
// you click is (roughly) the backdrop you get.
const SCENE_PREVIEW = {
  aurora: "linear-gradient(135deg,#0b1023 0%,#16213e 45%,#3b2a7a 70%,#0f3460 100%)",
  sunset: "linear-gradient(135deg,#2d1b4e 0%,#93326e 55%,#f2733f 100%)",
  forest: "linear-gradient(135deg,#0a1f1a 0%,#12372e 55%,#1d5c43 100%)",
  slate: "linear-gradient(135deg,#1a1d24 0%,#23272f 55%,#161920 100%)",
};

/**
 * 🖼️ Background effects picker (Teams/Meet style) for the call controls row.
 * Blur or replace your background — first selection lazy-loads the MediaPipe
 * segmentation model (~1 MB), so the panel shows a brief "warming up" hint.
 */
export default function BackgroundPicker({ call }) {
  const [open, setOpen] = useState(false);
  const [warming, setWarming] = useState(false);
  const [customPreview, setCustomPreview] = useState(null); // object URL for the thumbnail
  const fileRef = useRef(null);
  const { background, setBackground, hasVideo } = call;

  if (!hasVideo) return null;

  async function pick(id, image) {
    if (id !== "none" && background === "none") {
      setWarming(true);
      setTimeout(() => setWarming(false), 2500); // hint only — pipeline swaps in live
    }
    await setBackground(id, image);
  }

  function onFile(e) {
    const file = e.target.files?.[0];
    e.target.value = ""; // same file re-selectable
    if (!file || !file.type.startsWith("image/")) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      if (customPreview) URL.revokeObjectURL(customPreview);
      setCustomPreview(url);
      pick("custom", img); // img keeps the blob alive for the canvas pipeline
    };
    img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;
  }

  const active = background !== "none";
  const activeLabel = BG_EFFECTS.find((e) => e.id === background)?.label;

  const tileCls = (selected) =>
    `relative h-14 rounded-lg border overflow-hidden transition-all hover:scale-[1.04] ${
      selected
        ? "border-brand-400 ring-2 ring-brand-500/60 shadow-[0_0_12px_rgba(139,92,246,0.35)]"
        : "border-gray-700 hover:border-gray-500"
    }`;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        title="Background effects"
        className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
          active
            ? "bg-brand-700/80 border-brand-500 text-white"
            : "bg-gray-800 border-gray-700 text-gray-300 hover:border-brand-500"
        }`}
      >
        {active ? `🖼️ ${activeLabel}` : "🖼️ Background"}
      </button>

      {open && (
        <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 z-50 w-72 rounded-xl border border-gray-700 bg-gray-900/95 backdrop-blur p-3 shadow-xl">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-semibold text-white">Background</p>
            <button onClick={() => setOpen(false)} className="text-gray-500 hover:text-gray-300 text-xs">✕</button>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {/* none */}
            <button onClick={() => pick("none")} className={tileCls(background === "none")} title="No effect">
              <span className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 bg-gray-800/60">
                <span className="text-lg leading-none">🚫</span>
                <span className="text-[10px] text-gray-300">None</span>
              </span>
            </button>

            {/* blur levels */}
            {[["blur", "Blur"], ["blur-strong", "Blur+"]].map(([id, label]) => (
              <button key={id} onClick={() => pick(id)} className={tileCls(background === id)} title={label}>
                <span
                  className="absolute inset-0"
                  style={{ background: "radial-gradient(circle at 35% 35%, #6b7280 0%, #374151 60%, #1f2937 100%)", filter: id === "blur" ? "blur(3px)" : "blur(6px)" }}
                />
                <span className="absolute inset-0 flex flex-col items-center justify-center gap-0.5">
                  <span className="text-lg leading-none">👤</span>
                  <span className="text-[10px] text-gray-200 drop-shadow">{label}</span>
                </span>
              </button>
            ))}

            {/* designer scenes */}
            {Object.entries(SCENE_PREVIEW).map(([id, gradient]) => {
              const label = BG_EFFECTS.find((e) => e.id === id)?.label || id;
              return (
                <button key={id} onClick={() => pick(id)} className={tileCls(background === id)} title={label}>
                  <span className="absolute inset-0" style={{ background: gradient }} />
                  <span className="absolute bottom-0.5 inset-x-0 text-center text-[10px] text-white/90 drop-shadow">
                    {label}
                  </span>
                </button>
              );
            })}

            {/* custom upload */}
            <button
              onClick={() => (customPreview ? pick("custom") : fileRef.current?.click())}
              className={tileCls(background === "custom")}
              title="Use your own photo"
            >
              {customPreview ? (
                <img src={customPreview} alt="" className="absolute inset-0 w-full h-full object-cover" />
              ) : (
                <span className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 bg-gray-800/60 border-dashed">
                  <span className="text-lg leading-none">＋</span>
                  <span className="text-[10px] text-gray-300">Upload</span>
                </span>
              )}
            </button>
          </div>

          {customPreview && (
            <button
              onClick={() => fileRef.current?.click()}
              className="mt-2 w-full text-[11px] text-brand-300 hover:text-brand-200 text-center"
            >
              Change photo…
            </button>
          )}
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFile} />

          {warming && <p className="mt-2 text-[10px] text-brand-300 animate-pulse">Warming up the segmenter…</p>}
          <p className="mt-2 text-[10px] text-gray-600">Runs on your device — nothing leaves the browser.</p>
        </div>
      )}
    </div>
  );
}
