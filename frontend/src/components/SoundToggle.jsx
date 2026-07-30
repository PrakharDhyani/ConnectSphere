import { useState } from "react";
import { getMuted, setMuted, music } from "@/lib/sfx.js";

/** Speaker button that mutes ALL game audio (persisted in localStorage). */
export default function SoundToggle() {
  const [muted, set] = useState(getMuted());
  const toggle = () => {
    const next = !muted;
    setMuted(next);
    set(next);
    if (next) music.stop();
  };
  return (
    <button
      onClick={toggle}
      aria-label={muted ? "Unmute game sound" : "Mute game sound"}
      title={muted ? "Unmute game sound" : "Mute game sound"}
      className="text-lg px-2 py-1 rounded-lg bg-gray-900 border border-gray-800 hover:border-arcade-400"
    >
      {muted ? "🔇" : "🔊"}
    </button>
  );
}
