import { useState } from "react";
import GamePanel from "@/components/GamePanel.jsx";
import LudoPanel from "@/components/LudoPanel.jsx";

/** The Game tab: pick a game, then play it. */
export default function GamesHub({ roomId }) {
  const [game, setGame] = useState(null);

  if (!game) {
    return (
      <div className="max-w-md mx-auto text-center py-8">
        <h2 className="text-lg font-semibold mb-1">Game night 🎉</h2>
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
        </div>
      </div>
    );
  }

  return (
    <div>
      <button onClick={() => setGame(null)} className="text-sm text-gray-400 hover:text-brand-400 mb-3">
        ← Games
      </button>
      {game === "skribbl" ? <GamePanel roomId={roomId} /> : <LudoPanel roomId={roomId} />}
    </div>
  );
}
