import { useState } from "react";
import Button from "@/components/ui/Button.jsx";

const BOT_LEVELS = [
  { id: "easy", name: "Easy" },
  { id: "medium", name: "Medium" },
  { id: "hard", name: "Hard" },
];

/**
 * Shared arcade lobby for the framework games (chess/UNO/typing/bingo):
 * seat list, host bot controls, start button, spectate banner. Each game
 * renders this until `state.status === "playing"`.
 */
export default function GameLobby({
  title, emoji, tagline, minPlayers, maxPlayers, allowBots = true,
  lobby, // the useLobbyGame() bundle
}) {
  const { me, state, seated, isHost, join, leave, start, addBot, removeBot } = lobby;
  const [error, setError] = useState(null);
  const [botDiff, setBotDiff] = useState("medium");
  const players = state?.players || [];

  const run = async (fn) => {
    setError(null);
    const res = await fn();
    if (res?.error) setError(res.error);
  };

  return (
    <div className="max-w-md mx-auto bg-gradient-to-b from-arcade-950/40 to-gray-900 border border-arcade-500/25 rounded-2xl p-6 text-center">
      <p className="text-4xl mb-2">{emoji}</p>
      <h2 className="text-xl font-black tracking-wide text-arcade-300 drop-shadow-[0_0_10px_rgba(34,211,238,0.4)]">
        {title}
      </h2>
      <p className="text-gray-500 text-sm mt-1">{tagline}</p>

      <div className="mt-4 text-left">
        <p className="text-xs uppercase tracking-wider text-arcade-300/70 mb-2">
          Players ({players.length}/{maxPlayers})
        </p>
        <ul className="space-y-1">
          {players.map((p) => (
            <li key={p.id} className="flex items-center gap-2 text-sm">
              <span className="w-2 h-2 rounded-full bg-arcade-400" />
              <span>{p.name}{p.id === me?.id && " (you)"}</span>
              {p.isBot && <span className="text-xs px-1.5 rounded bg-gray-800 text-gray-400">bot</span>}
              {p.id === state?.hostId && <span className="text-xs text-gray-500">host</span>}
              {isHost && p.isBot && (
                <button
                  onClick={() => run(() => removeBot(p.id))}
                  className="ml-auto text-xs text-gray-500 hover:text-red-400"
                >
                  remove
                </button>
              )}
            </li>
          ))}
          {players.length === 0 && <li className="text-sm text-gray-600">Nobody seated yet.</li>}
        </ul>
      </div>

      {isHost && allowBots && (
        <div className="mt-4 pt-4 border-t border-gray-800 text-left">
          <p className="text-xs uppercase tracking-wider text-arcade-300/70 mb-1.5">Add a bot</p>
          <div className="flex items-center gap-2">
            <div className="flex gap-1">
              {BOT_LEVELS.map((d) => (
                <button
                  key={d.id}
                  onClick={() => setBotDiff(d.id)}
                  className={`px-2 py-1 rounded-md text-xs border ${
                    botDiff === d.id
                      ? "bg-arcade-400 text-gray-950 font-semibold border-arcade-300 shadow-[0_0_10px_rgba(34,211,238,0.45)]"
                      : "bg-gray-800 border-gray-700 hover:border-arcade-400"
                  }`}
                >
                  {d.name}
                </button>
              ))}
            </div>
            <button
              onClick={() => run(() => addBot(botDiff))}
              disabled={players.length >= maxPlayers}
              className="ml-auto px-3 py-1 rounded-md text-sm bg-gray-800 border border-gray-700 hover:border-arcade-400 disabled:opacity-40"
            >
              + Bot
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-red-400 mt-3">{error}</p>}

      <div className="mt-5 flex items-center justify-center gap-2">
        {seated ? (
          <Button variant="secondary" onClick={() => run(leave)}>Leave seat</Button>
        ) : (
          <Button variant="arcade" onClick={() => run(join)} disabled={players.length >= maxPlayers}>
            Take a seat
          </Button>
        )}
        {isHost && (
          <Button variant="arcade" onClick={() => run(start)} disabled={players.length < minPlayers}>
            Start game
          </Button>
        )}
      </div>
      {!isHost && seated && <p className="text-xs text-gray-600 mt-3">Waiting for the host to start…</p>}
    </div>
  );
}

/** Shared "you're watching" banner for mid-game arrivals. */
export function SpectateBanner() {
  return (
    <div className="bg-amber-500/10 border border-amber-500/40 text-amber-300 rounded-xl px-4 py-2 text-sm text-center mb-3">
      👀 Game in progress — you&apos;re spectating. A seat opens when it ends!
    </div>
  );
}

/** Shared notice ticker (AFK warnings, UNO shouts…). */
export function NoticeFeed({ notices }) {
  if (!notices?.length) return null;
  return (
    <div className="space-y-0.5 text-center">
      {notices.slice(-3).map((n) => (
        <p key={n.id} className="text-[11px] text-amber-300/90">{n.text}</p>
      ))}
    </div>
  );
}
