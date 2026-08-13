/**
 * "What is happening in this room, right now?"
 *
 * The dashboard's room cards showed `memberCount` — how many people have EVER
 * joined — which is a roster, not a signal. A room with 3 members looks
 * identical whether it is empty or has all three mid-game, so the number stops
 * telling you anything the moment you have more than a couple of rooms.
 *
 * This answers the live question instead: who is present, who is on the call,
 * and who is inside which activity. Three facts the server already knew and
 * never surfaced outside the room itself:
 *
 *   presence  → sockets in `room:<id>`          (chat.handlers)
 *   call      → mediasoup peers                 (media.handlers)
 *   activity  → sockets in `act:<plugin>:<id>`  (activities/sdk)
 *
 * ALL THREE ARE READ FROM SOCKET.IO, NOT STORED. There is no activity table to
 * keep in sync, nothing to clean up when a tab closes, and no way for the
 * summary to disagree with reality: if a socket is in the room it is counted,
 * and when it disconnects it stops being counted. A stored "currently playing"
 * flag would need a heartbeat, an expiry, and a reconciliation job — three new
 * things that can be wrong — to answer a question the connection already
 * answers by existing.
 *
 * COST: one `fetchSockets()` per activity per room. Fine for a dashboard that
 * lists a handful of rooms; if that ever changes, the fix is a cached snapshot
 * refreshed on presence events, not a database table.
 */
import { getAllPlugins } from "../../../shared/activities/index.js";
import { activityKey } from "../activities/sdk.js";
import { roomKey } from "../sockets/chat.handlers.js";
import { callParticipants } from "../sockets/media.handlers.js";

/**
 * How to describe each activity in a sentence, by manifest CATEGORY.
 *
 * Keyed on category rather than plugin id so a new plugin gets a sensible
 * phrase for free — the whole point of the manifest system is that adding one
 * edits no existing file, and a hardcoded id→verb map here would quietly break
 * that guarantee the first time someone shipped a plugin and wondered why the
 * dashboard called it "using".
 */
const PHRASE_BY_CATEGORY = Object.freeze({
  games: "playing",
  creativity: "creating on",
  productivity: "working on",
  learning: "studying with",
  media: "watching",
});

/**
 * Per-plugin overrides, ONLY where the category verb reads wrong.
 *
 * Deliberately short. Each entry is a phrase a human would actually say —
 * "brainstorming on the whiteboard" rather than "creating on Whiteboard" — and
 * anything not listed falls back to the category verb rather than accumulating
 * an entry per plugin.
 */
const PHRASE_BY_ID = Object.freeze({
  whiteboard: "brainstorming on",
  "sticky-notes": "sticking notes on",
  skribbl: "drawing and guessing in",
  typing: "racing at",
});

const plural = (n, one, many) => (n === 1 ? one : many);

/** "Two people are playing Ludo" — the sentence the card shows. */
function describe(count, manifest) {
  const verb = PHRASE_BY_ID[manifest.id] || PHRASE_BY_CATEGORY[manifest.category] || "using";
  const who = count === 1 ? "1 person is" : `${count} people are`;
  return `${who} ${verb} ${manifest.name}`;
}

/**
 * A live snapshot for ONE room.
 *
 * @returns {{present, inCall, activities: Array<{id,name,icon,count,label}>, headline}}
 */
export async function roomActivitySnapshot(io, roomId) {
  if (!io) return emptySnapshot();

  // Distinct PEOPLE, not sockets: one person with three tabs is one person, and
  // a card claiming "3 people are here" for one user with tabs open would be a
  // lie that makes the whole feature untrustworthy.
  const sockets = await io.in(roomKey(roomId)).fetchSockets();
  const present = new Set(sockets.map((s) => s.user?.id).filter(Boolean)).size;

  const call = callParticipants(roomId);

  const activities = [];
  for (const manifest of getAllPlugins()) {
    const inActivity = await io.in(activityKey(manifest.id, roomId)).fetchSockets();
    const count = new Set(inActivity.map((s) => s.user?.id).filter(Boolean)).size;
    if (count === 0) continue;
    activities.push({
      id: manifest.id,
      name: manifest.name,
      icon: manifest.icon,
      count,
      label: describe(count, manifest),
    });
  }
  // Busiest first — with limited space on a card, the most alive thing wins.
  activities.sort((a, b) => b.count - a.count);

  /**
   * The call is an activity for display purposes, but it is NOT a plugin, so it
   * is added here rather than living in the loop above. It leads the list
   * because a live call is the strongest "join us" signal a room has.
   */
  if (call.length > 0) {
    activities.unshift({
      id: "call",
      name: "Call",
      icon: "🎧",
      count: call.length,
      label: `${call.length === 1 ? "1 person is" : `${call.length} people are`} on a call`,
    });
  }

  return {
    present,
    inCall: call.length,
    activities,
    headline: headlineFor(present, activities),
  };
}

/**
 * One line for the card when there is no room to rotate through several.
 *
 * "3 here" is deliberately the fallback rather than nothing: an empty room and
 * a room with three silent people are different, and the card should say so.
 */
function headlineFor(present, activities) {
  if (activities.length > 0) return activities[0].label;
  if (present > 0) return `${present} ${plural(present, "person", "people")} here`;
  return null;
}

const emptySnapshot = () => ({ present: 0, inCall: 0, activities: [], headline: null });

/** Snapshots for many rooms at once — the dashboard's list. */
export async function roomActivitySnapshots(io, roomIds) {
  const entries = await Promise.all(
    roomIds.map(async (id) => [String(id), await roomActivitySnapshot(io, String(id))])
  );
  return Object.fromEntries(entries);
}

export { describe as describeActivity, emptySnapshot };
