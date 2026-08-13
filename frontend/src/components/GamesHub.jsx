import { useEffect, useState } from "react";
import SoundToggle from "@/components/SoundToggle.jsx";
import ActivityHost from "@/activities/ActivityHost.jsx";
import { music } from "@/lib/sfx.js";

/**
 * The Game tab — visually its own place: the platform chrome is violet, the
 * arcade is neon CYAN + amber (complementary, not matching), with a faint
 * scanline texture. Stepping into Games should feel like entering an arcade.
 *
 * ── THIS FILE USED TO HARDCODE THE GAME LIST ────────────────────────────────
 * A literal `GAMES[]` array plus seven `game === "x" && <Panel/>` branches. It
 * was the fourth coupling point the migration plan named (§1.3) and the last
 * one left standing: the tab bar became manifest-driven in Phase 3, but the
 * arcade behind it still showed every game ever written, regardless of what the
 * room installed. Creating a room with two games and finding all seven in it
 * was this array — not a server bug.
 *
 * Now the list comes from the room's installed activities, and each panel is
 * mounted through ActivityHost — the same resolver the tabs use. A game appears
 * here by being installed, and nowhere else.
 */

// Subtle CRT scanlines + glow wash behind everything in the arcade.
const arcadeShell =
  "relative rounded-2xl border border-arcade-500/25 bg-gradient-to-b from-arcade-950/50 via-gray-950 to-gray-950 p-4 sm:p-6 " +
  "shadow-[inset_0_0_60px_rgba(6,182,212,0.06)]";
const scanlines = {
  backgroundImage: "repeating-linear-gradient(0deg, rgba(103,232,249,0.035) 0px, rgba(103,232,249,0.035) 1px, transparent 1px, transparent 4px)",
};

/**
 * Arcade flavour text under each game's name.
 *
 * Not taken from the manifest: `description` there is a full sentence written
 * for the creation wizard ("Classic 2–4 player board game, with bots."), which
 * reads wrong on a neon arcade tile. A game with no entry here falls back to
 * its manifest's player range, so a new game still renders sensibly rather
 * than blank.
 */
const HINTS = {
  skribbl: "Skribbl-style",
  ludo: "2–4 players",
  kart: "3D deathmatch · up to 10",
  chess: "1v1 · beatable bots",
  uno: "2–6 players · card chaos",
  typing: "fastest fingers · up to 8",
  bingo: "daub & shout · up to 10",
};

const hintFor = (a) => {
  if (HINTS[a.id]) return HINTS[a.id];
  const { minPlayers, maxPlayers } = a.manifest || {};
  if (minPlayers && maxPlayers) return `${minPlayers}–${maxPlayers} players`;
  return "";
};

/**
 * @param {string} roomId
 * @param {Array}  games  the room's installed game activities, as returned by
 *                        useRoomActivities().gameActivities
 */
export default function GamesHub({ roomId, games = [] }) {
  // Refresh-proof: restore the open game after F5 (per browser tab, per room)
  // so refreshing mid-Ludo doesn't dump you back on the picker.
  const gameKey = `groot:game:${roomId}`;
  const [game, setGameRaw] = useState(() => {
    try { return sessionStorage.getItem(gameKey) || null; } catch { return null; }
  });
  const setGame = (g) => {
    setGameRaw(g);
    try {
      if (g) sessionStorage.setItem(gameKey, g);
      else sessionStorage.removeItem(gameKey);
    } catch { /* private mode */ }
  };

  /**
   * A restored game that the room no longer has must not reopen.
   *
   * sessionStorage outlives the room's configuration: play Ludo, have the owner
   * uninstall it, refresh — without this you land in a game the room does not
   * have, whose socket events the server now refuses. Falls back to the picker.
   */
  useEffect(() => {
    if (game && games.length && !games.some((g) => g.id === game)) setGame(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, games]);

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

          {games.length === 0 ? (
            // Reachable when every game is uninstalled while someone is looking
            // at the tab. The tab itself is hidden in that case, so this is a
            // race, not a dead end — say so rather than showing an empty grid.
            <p className="text-arcade-300/50 text-sm py-6">
              No games are installed in this room.
              <br />
              The room owner can add some from the 🧩 Plugins menu.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {games.map((a, i) => (
                <button
                  key={a.id}
                  onClick={() => setGame(a.id)}
                  className={`group bg-gray-900/80 border border-arcade-500/25 rounded-2xl p-6 transition-all
                    hover:border-arcade-400 hover:shadow-[0_0_20px_rgba(34,211,238,0.25)] hover:-translate-y-0.5
                    anim-fade-up d${Math.min(6, i + 1)}`}
                >
                  <div className="text-4xl transition-transform group-hover:scale-110">{a.manifest.icon}</div>
                  <div className="mt-2 font-semibold text-arcade-100">{a.manifest.name}</div>
                  <div className="text-xs text-arcade-300/50">{hintFor(a)}</div>
                </button>
              ))}
            </div>
          )}
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
        {/* One host per installed game, resolved from the registry instead of a
            branch per game. Kept mounted once opened so switching to the picker
            and back does not throw away a live board — the same rule the room's
            tabs follow. */}
        {games.map((a) => (
          <ActivityHost
            key={a.id}
            activityId={a.id}
            roomId={roomId}
            active={game === a.id}
            mounted={game === a.id}
            // Kart's in-game Exit button. Harmless for panels that ignore it.
            onExit={() => setGame(null)}
          />
        ))}
      </div>
    </div>
  );
}
