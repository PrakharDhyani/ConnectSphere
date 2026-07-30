import { useEffect, useState } from "react";
import GamePanel from "@/components/GamePanel.jsx";
import LudoPanel from "@/components/LudoPanel.jsx";
import KartPanel from "@/components/KartPanel.jsx";
import SoundToggle from "@/components/SoundToggle.jsx";
import { music } from "@/lib/sfx.js";

/** The Game tab: pick a game, then play it. */
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
      <div className="max-w-md mx-auto text-center py-8">
        <div className="flex items-center justify-center gap-2 mb-1">
          <h2 className="text-lg font-semibold">Game night 🎉</h2>
          <SoundToggle />
        </div>
        <p className="text-gray-500 text-sm mb-5">Pick something to play together.</p>
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => setGame("skribbl")}
            className="bg-gray-900 border border-gray-800 rounded-2xl p-6 hover:border-brand-600 transition-colors"
          >
            <div className="text-4xl">🎨</div>
            <div className="mt-2 font-medium">Draw &amp; Guess</div>
            <div className="text-xs text-gray-500">Skribbl-style</div>
          </button>
          <button
            onClick={() => setGame("ludo")}
            className="bg-gray-900 border border-gray-800 rounded-2xl p-6 hover:border-brand-600 transition-colors"
          >
            <div className="text-4xl">🎲</div>
            <div className="mt-2 font-medium">Ludo</div>
            <div className="text-xs text-gray-500">2–4 players</div>
          </button>
          <button
            onClick={() => setGame("kart")}
            className="bg-gray-900 border border-gray-800 rounded-2xl p-6 hover:border-brand-600 transition-colors"
          >
            <div className="text-4xl">🏎️</div>
            <div className="mt-2 font-medium">Smash Karts 3D</div>
            <div className="text-xs text-gray-500">3D deathmatch · up to 10</div>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <button onClick={() => setGame(null)} className="text-sm text-gray-400 hover:text-brand-400">
          ← Games
        </button>
        <SoundToggle />
      </div>
      {game === "skribbl" && <GamePanel roomId={roomId} />}
      {game === "ludo" && <LudoPanel roomId={roomId} />}
      {game === "kart" && <KartPanel roomId={roomId} onExit={() => setGame(null)} />}
    </div>
  );
}
