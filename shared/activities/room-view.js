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
 *
 * `tab` is the surface for a plugin that wants a tab OF ITS OWN, named from its
 * own manifest — Sticky Notes, Kanban, a code editor. It used to alias onto
 * "board", which meant the second such plugin was silently dropped by the
 * single-slot board lookup below. That was invisible while whiteboard was the
 * only board-ish plugin and became a blocker the moment a second one existed;
 * a `tab` plugin now gets `tab:<id>` and there is no shared slot to lose.
 */
export const SURFACE_TAB = Object.freeze({
  board: "board",
  game: "game",
  tab: "tab",
  overlay: "room",
});

/** The tab id a `surface: "tab"` plugin owns. One per plugin, never shared. */
export const ownTabId = (activityId) => `tab:${activityId}`;

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
  const tabActivities = bySurface("tab");

  // Tabs are DERIVED, not listed. A tab appears only if something can render
  // in it — a room with no games should not show an empty Game tab.
  //
  // `activityId` on a tab is what lets the room render the tab BODY generically:
  // the shell mounts <ActivityHost activityId={tab.activityId}> instead of
  // naming a component. Without it the tab bar was manifest-driven while the
  // content underneath was still a hardcoded <WhiteboardPanel/>.
  const tabs = [{ ...ROOM_TAB }];
  if (boardActivity) {
    tabs.push({
      id: "board",
      label: boardActivity.manifest.name,
      icon: boardActivity.manifest.icon,
      activityId: boardActivity.id,
    });
  }
  // Own-tab plugins, in installed order so the room's own arrangement is stable
  // rather than dependent on registry order.
  for (const a of tabActivities) {
    tabs.push({ id: ownTabId(a.id), label: a.manifest.name, icon: a.manifest.icon, activityId: a.id });
  }
  if (gameActivities.length) {
    // The Game tab is a hub over several plugins, so it keeps a generic name
    // rather than borrowing one game's. Its body is the hub, not one activity,
    // so it carries no activityId.
    tabs.push({ id: "game", label: "Game", icon: "🎮" });
  }

  const tabFor = (activityId) => {
    if (CORE_ACTIVITIES[activityId]) return CORE_ACTIVITIES[activityId].tab;
    const id = canonical(activityId);
    const manifest = getPlugin(id);
    // An own-tab plugin's destination is its own tab, which is per-plugin and
    // therefore cannot come from the static surface map.
    if (manifest?.surface === "tab") return ownTabId(id);
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

  return { tabs, activities: usable, boardActivity, gameActivities, overlayActivities, tabActivities, describe, tabFor };
}
