import { useEffect, useState } from "react";
import GamePanel from "@/components/GamePanel.jsx";
import LudoPanel from "@/components/LudoPanel.jsx";
import KartPanel from "@/components/KartPanel.jsx";
import SoundToggle from "@/components/SoundToggle.jsx";
import { music } from "@/lib/sfx.js";

/**
 * The Game tab — visually its own place: the platform chrome is violet, the
 * arcade is neon CYAN + amber (complementary, not matching), with a faint
 * scanline texture. Stepping into Games should feel like entering an arcade.
 */

// Subtle CRT scanlines + glow wash behind everything in the arcade.
const arcadeShell =
  "relative rounded-2xl border border-arcade-500/25 bg-gradient-to-b from-arcade-950/50 via-gray-950 to-gray-950 p-4 sm:p-6 " +
  "shadow-[inset_0_0_60px_rgba(6,182,212,0.06)]";
const scanlines = {
  backgroundImage: "repeating-linear-gradient(0deg, rgba(103,232,249,0.035) 0px, rgba(103,232,249,0.035) 1px, transparent 1px, transparent 4px)",
};

const GAMES = [
  { id: "skribbl", emoji: "🎨", name: "Draw & Guess", hint: "Skribbl-style" },
  { id: "ludo", emoji: "🎲", name: "Ludo", hint: "2–4 players" },
  { id: "kart", emoji: "🏎️", name: "Smash Karts 3D", hint: "3D deathmatch · up to 10" },
];

export default function GamesHub({ roomId }) {
  const [game, setGame] = useState(null);

  // Background music follows the selected game; silence on the picker.
  useEffect(() => {
    if (game) music.start(game);
    else music.stop();
    return () => music.stop();
  }, [game]);

  if (!game) {
    return (
      <div className={`${arcadeShell} max-w-lg mx-auto text-center py-8`}>
        <div className="absolute inset-0 rounded-2xl pointer-events-none" style={scanlines} />
        <div className="relative">
          <div className="flex items-center justify-center gap-3 mb-1">
            <h2 className="text-2xl font-black tracking-wide uppercase bg-gradient-to-r from-arcade-300 via-arcade-400 to-amber-300 bg-clip-text text-transparent drop-shadow-[0_0_12px_rgba(34,211,238,0.35)]">
              🕹️ Game Night
            </h2>
            <SoundToggle />
          </div>
          <p className="text-arcade-300/60 text-sm mb-6 tracking-wide">insert coin · pick a game</p>
          <div className="grid grid-cols-2 gap-3">
            {GAMES.map((g) => (
              <button
                key={g.id}
                onClick={() => setGame(g.id)}
                className="group bg-gray-900/80 border border-arcade-500/25 rounded-2xl p-6 transition-all
                  hover:border-arcade-400 hover:shadow-[0_0_20px_rgba(34,211,238,0.25)] hover:-translate-y-0.5"
              >
                <div className="text-4xl transition-transform group-hover:scale-110">{g.emoji}</div>
                <div className="mt-2 font-semibold text-arcade-100">{g.name}</div>
                <div className="text-xs text-arcade-300/50">{g.hint}</div>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={arcadeShell}>
      <div className="absolute inset-0 rounded-2xl pointer-events-none" style={scanlines} />
      <div className="relative">
        <div className="flex items-center justify-between mb-3">
          <button
            onClick={() => setGame(null)}
            className="text-sm font-medium text-arcade-300/80 hover:text-arcade-300 tracking-wide"
          >
            ← Arcade
          </button>
          <SoundToggle />
        </div>
        {game === "skribbl" && <GamePanel roomId={roomId} />}
        {game === "ludo" && <LudoPanel roomId={roomId} />}
        {game === "kart" && <KartPanel roomId={roomId} onExit={() => setGame(null)} />}
      </div>
    </div>
  );
}
