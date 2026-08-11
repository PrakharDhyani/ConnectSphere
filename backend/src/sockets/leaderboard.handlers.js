/**
 * Global leaderboards — CORE socket handlers, not a plugin.
 *
 * WHY THIS FILE EXISTS (§56)
 * `typing:leaderboard` used to live inside `registerTypingHandlers`, alongside
 * the game's own socket wiring. When the legacy registrations were deleted it
 * would have gone with them — and it is a LIVE feature: `TypingPanel` calls it
 * after every timed run to show fresh records.
 *
 * It did not simply move into the typing plugin, because it does not belong to
 * a room. A leaderboard is global: top-10 across the whole server, readable by
 * any authenticated socket whether or not they have the typing activity
 * installed, or are in a room at all. The plugin host quite correctly refuses
 * an activity event from someone whose room has not installed that activity —
 * which is the right rule for gameplay and the wrong one for a scoreboard.
 *
 * So it sits with chat, presence and polls: core, always registered.
 */
import { TypingRecord } from "../models/TypingRecord.js";

export function registerLeaderboardHandlers(io, socket) {
  /**
   * Global top-10 typing speeds (from the 60s timed mode). Public to any
   * authenticated socket — it is a leaderboard, not a secret.
   */
  socket.on("typing:leaderboard", async (_payload, cb) => {
    try {
      const top = await TypingRecord.topTen();
      cb?.({ ok: true, top });
    } catch {
      cb?.({ error: "Leaderboard unavailable" });
    }
  });
}
