import { useVoiceRecorder, fmtDuration } from "@/hooks/useVoiceRecorder.js";

/**
 * 🎙️ Voice-note recorder for the composer.
 *
 * Idle → a mic button. Recording → an inline bar with a live level meter, a
 * timer, pause, discard and send. The finished blob is handed to `onSend`
 * along with its duration and waveform, which the caller uploads like any
 * other attachment (voice notes are `kind: "audio"` with `voice: true`).
 */
export default function VoiceComposer({ onSend, disabled }) {
  const rec = useVoiceRecorder();

  async function finish() {
    const note = await rec.stop();
    if (note?.blob && note.blob.size > 0) onSend(note);
  }

  if (!rec.recording) {
    return (
      <>
        <button
          type="button"
          onClick={rec.start}
          disabled={disabled}
          title="Record a voice note"
          className="w-8 h-8 rounded-lg text-lg leading-none hover:bg-white/5 transition-colors disabled:opacity-40"
        >
          🎙️
        </button>
        {rec.error && (
          <span className="text-[10px] text-amber-300 max-w-[130px] truncate" title={rec.error}>
            {rec.error}
          </span>
        )}
      </>
    );
  }

  const nearLimit = rec.seconds > rec.maxSeconds - 30;

  return (
    <div className="flex items-center gap-2 flex-1 min-w-0 px-1">
      <button
        type="button"
        onClick={rec.cancel}
        title="Discard"
        className="w-8 h-8 rounded-lg text-gray-400 hover:text-red-400 hover:bg-white/5 shrink-0"
      >
        🗑️
      </button>

      <span className={`shrink-0 w-2 h-2 rounded-full ${rec.paused ? "bg-gray-500" : "bg-red-500 animate-pulse"}`} />

      {/* Live level meter — 20 bars driven by the analyser's RMS. The centre
          bars react most, so quiet speech still shows movement. */}
      <div className="flex items-center gap-[2px] flex-1 min-w-0 h-7">
        {Array.from({ length: 20 }).map((_, i) => {
          const distance = Math.abs(i - 9.5) / 9.5;          // 0 centre → 1 edge
          const weight = 1 - distance * 0.65;
          const height = rec.paused ? 3 : Math.max(3, rec.level * 26 * weight);
          return (
            <span
              key={i}
              className="flex-1 rounded-full bg-brand-400/80 transition-[height] duration-75"
              style={{ height: `${height}px` }}
            />
          );
        })}
      </div>

      <span className={`shrink-0 text-xs tabular-nums ${nearLimit ? "text-amber-300" : "text-gray-400"}`}>
        {fmtDuration(rec.seconds * 1000)}
      </span>

      <button
        type="button"
        onClick={rec.togglePause}
        title={rec.paused ? "Resume" : "Pause"}
        className="w-8 h-8 rounded-lg text-gray-300 hover:bg-white/5 shrink-0"
      >
        {rec.paused ? "▶" : "⏸"}
      </button>

      <button
        type="button"
        onClick={finish}
        title="Send voice note"
        className="w-8 h-8 rounded-lg flex items-center justify-center bg-gradient-to-r from-brand-600 to-fuchsia-600 text-white shadow-[0_2px_10px_rgba(139,92,246,0.35)] hover:brightness-110 shrink-0"
      >
        <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor" aria-hidden="true">
          <path d="M3.4 20.4 21.9 12 3.4 3.6l.01 6.53L15.3 12 3.41 13.87z" />
        </svg>
      </button>
    </div>
  );
}
