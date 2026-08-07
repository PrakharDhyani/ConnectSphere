/**
 * Room → tabs/labels. Pure functions, no React.
 *
 * WHY THIS IS IN shared/ RATHER THAN THE HOOK
 * This is the logic that replaced the three hand-maintained lists in
 * RoomPage (the tab array, ACT_LABEL, ACT_VIEW). It decides what the user
 * sees, so it deserves tests — and the frontend has no test runner, while the
 * backend suite already has one. Being pure and dependency-free, it runs in
 * both. The hook is then a thin useMemo over these.
 */
import { resolveActivities, getPlugin } from "./index.js";

/**
 * Surfaces map onto the room's tabs. The room tab is core (chat), so it is
 * prepended rather than derived from any plugin.
 *
 * "overlay" activities (polls) render inside the room tab rather than owning
 * one — composed into an existing surface, not given their own.
 */
export const SURFACE_TAB = Object.freeze({
  board: "board",
  game: "game",
  tab: "board",
  overlay: "room",
});

/**
 * Not every activity broadcast names a plugin. `call` is CORE (mediasoup is
 * deliberately not a plugin), so the room owns its wording — dropping it here
 * would silently downgrade "started the call 📞" to "started an activity".
 */
export const CORE_ACTIVITIES = Object.freeze({
  call: { label: "started the call 📞", tab: "room" },
});

/** Historical ids still emitted by clients older than the plugin system. */
export const ACTIVITY_ALIASES = Object.freeze({ board: "whiteboard" });

export const ROOM_TAB = Object.freeze({ id: "room", label: "Room", icon: "💬" });

const canonical = (id) => ACTIVITY_ALIASES[id] || id;

/**
 * @param {object} room
 * @param {(id:string)=>boolean} hasClientModule  is it implemented on this client?
 */
export function buildRoomView(room, hasClientModule = () => true) {
  // resolveActivities handles the legacy case: a room with no `activities`
  // field resolves to the full historical set, so old rooms look unchanged.
  const usable = resolveActivities(room || {}).filter(
    (a) => a.enabled && !a.unavailable && hasClientModule(a.id)
  );

  const bySurface = (s) => usable.filter((a) => a.manifest.surface === s);
  const boardActivity = bySurface("board")[0] || null;
  const gameActivities = bySurface("game");
  const overlayActivities = bySurface("overlay");

  // Tabs are DERIVED, not listed. A tab appears only if something can render
  // in it — a room with no games should not show an empty Game tab.
  const tabs = [{ ...ROOM_TAB }];
  if (boardActivity) {
    tabs.push({ id: "board", label: boardActivity.manifest.name, icon: boardActivity.manifest.icon });
  }
  if (gameActivities.length) {
    // The Game tab is a hub over several plugins, so it keeps a generic name
    // rather than borrowing one game's.
    tabs.push({ id: "game", label: "Game", icon: "🎮" });
  }

  const tabFor = (activityId) => {
    if (CORE_ACTIVITIES[activityId]) return CORE_ACTIVITIES[activityId].tab;
    const manifest = getPlugin(canonical(activityId));
    return SURFACE_TAB[manifest?.surface] || "room";
  };

  /**
   * "started Ludo 🎲" — built from the manifest instead of a lookup table
   * someone has to remember to extend. An unknown id still reads sensibly,
   * which matters when a client is older than the room.
   */
  const describe = (activityId) => {
    const core = CORE_ACTIVITIES[activityId];
    if (core) return core.label;
    const manifest = getPlugin(canonical(activityId));
    if (!manifest) return "started an activity";
    return `started ${manifest.name} ${manifest.icon}`;
  };

  return { tabs, activities: usable, boardActivity, gameActivities, overlayActivities, describe, tabFor };
}
