import { useState } from "react";

/** Languages LibreTranslate ships models for (subset that matters here). */
export const SPEAK_LANGS = [
  ["en-US", "English"],
  ["hi-IN", "हिन्दी"],
  ["es-ES", "Español"],
  ["fr-FR", "Français"],
  ["de-DE", "Deutsch"],
  ["pt-BR", "Português"],
  ["ja-JP", "日本語"],
  ["zh-CN", "中文"],
  ["ar-SA", "العربية"],
  ["ru-RU", "Русский"],
];
export const TARGET_LANGS = [
  ["", "Don't translate"],
  ["en", "English"],
  ["hi", "हिन्दी"],
  ["es", "Español"],
  ["fr", "Français"],
  ["de", "Deutsch"],
  ["pt", "Português"],
  ["ja", "日本語"],
  ["zh", "中文"],
  ["ar", "العربية"],
  ["ru", "Русский"],
];

/**
 * Subtitle strip pinned above the bottom edge — visible on every tab (voice
 * chat while gaming is exactly when you can't watch the chat pane). One line
 * per active speaker, newest at the bottom, interim lines shimmer.
 */
export function CaptionOverlay({ lines }) {
  if (!lines.length) return null;
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 w-[min(90vw,42rem)] space-y-1 pointer-events-none">
      {lines.slice(-3).map((l) => (
        <p
          key={l.userId}
          className="mx-auto w-fit max-w-full rounded-lg bg-black/75 backdrop-blur px-3 py-1.5 text-center text-white text-[15px] leading-snug shadow-lg"
        >
          <span className="text-brand-300 font-semibold">{l.name}: </span>
          <span className={l.interim ? "opacity-70 italic" : ""}>{l.text}</span>
          {l.orig && <span className="block text-[11px] text-gray-400 truncate">“{l.orig}”</span>}
        </p>
      ))}
    </div>
  );
}

/**
 * The CC button + its settings flyout ("I speak" / "Translate to"). Compact
 * enough to live in the call controls row and the floating VoiceBar.
 */
export function CaptionControls({ captions, compact = false }) {
  const [open, setOpen] = useState(false);
  const { supported, micCaptioning, startMic, stopMic, speakLang, setSpeakLang, targetLang, setTargetLang, error } =
    captions;

  const btnCls = compact
    ? `w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold ${
        micCaptioning ? "bg-brand-600 text-white" : "bg-gray-800 hover:bg-gray-700 text-gray-300"
      }`
    : `px-4 py-2 rounded-lg text-sm font-medium border ${
        micCaptioning
          ? "bg-brand-600 border-brand-500 text-white"
          : "bg-gray-800 border-gray-700 text-gray-300 hover:border-brand-500"
      }`;

  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className={btnCls} title="Live captions">
        {compact ? "CC" : micCaptioning ? "💬 CC on" : "💬 CC"}
      </button>

      {open && (
        <div className="absolute bottom-full mb-2 right-0 z-50 w-64 rounded-xl border border-gray-700 bg-gray-900/95 backdrop-blur p-3 shadow-xl space-y-3 text-left">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-white">Live captions</p>
            <button onClick={() => setOpen(false)} className="text-gray-500 hover:text-gray-300 text-xs">✕</button>
          </div>

          {supported ? (
            <button
              onClick={() => (micCaptioning ? stopMic() : startMic())}
              className={`w-full rounded-lg px-3 py-2 text-sm font-medium ${
                micCaptioning ? "bg-red-600/80 hover:bg-red-600 text-white" : "bg-brand-600 hover:bg-brand-500 text-white"
              }`}
            >
              {micCaptioning ? "⏹ Stop captioning my voice" : "🎙️ Caption my voice"}
            </button>
          ) : (
            <p className="text-xs text-amber-300">
              This browser can’t transcribe speech (try Chrome/Edge) — you’ll still see everyone else’s captions.
            </p>
          )}
          {error && <p className="text-xs text-red-400">{error}</p>}

          <label className="block text-xs text-gray-400">
            I speak
            <select
              value={speakLang}
              onChange={(e) => setSpeakLang(e.target.value)}
              className="mt-1 w-full bg-gray-950 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-gray-200 focus:outline-none"
            >
              {SPEAK_LANGS.map(([v, label]) => (
                <option key={v} value={v}>{label}</option>
              ))}
            </select>
          </label>

          <label className="block text-xs text-gray-400">
            Translate captions to
            <select
              value={targetLang}
              onChange={(e) => setTargetLang(e.target.value)}
              className="mt-1 w-full bg-gray-950 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-gray-200 focus:outline-none"
            >
              {TARGET_LANGS.map(([v, label]) => (
                <option key={v} value={v}>{label}</option>
              ))}
            </select>
          </label>
          <p className="text-[10px] text-gray-600">
            Recognition runs in your browser; only the text is shared with the room.
          </p>
        </div>
      )}
    </div>
  );
}
