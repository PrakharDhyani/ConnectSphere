/**
 * Room → tabs/labels: the logic that replaced the three hand-maintained lists
 * in RoomPage (tab array, ACT_LABEL, ACT_VIEW).
 *
 * Lives in shared/ precisely so it can be tested here — the frontend has no
 * test runner, and this decides what every user sees at the top of the room.
 * A silent regression (a tab vanishing, an activity described as "started an
 * activity") would be invisible to the backend suite otherwise.
 */
import { describe, it, expect } from "@jest/globals";
import { buildRoomView, ROOM_TAB, SURFACE_TAB, CORE_ACTIVITIES } from "../../shared/activities/room-view.js";
import { LEGACY_ACTIVITY_IDS } from "../../shared/activities/index.js";

// The frontend passes its real implementation check; default to "everything is
// implemented" and override where the test is about the missing case.
const all = () => true;

describe("tabs are derived from installed activities", () => {
  it("gives a legacy room the same three tabs it has always had", () => {
    const { tabs } = buildRoomView({}, all);
    expect(tabs.map((t) => t.id)).toEqual(["room", "board", "game"]);
  });

  it("names the board tab from the whiteboard manifest, not a literal", () => {
    const { tabs } = buildRoomView({}, all);
    const board = tabs.find((t) => t.id === "board");
    expect(board.label).toBe("Whiteboard");
    expect(board.icon).toBe("🖊️");
  });

  it("always starts with the core room tab", () => {
    // Chat is core, not a plugin — it cannot be uninstalled away.
    const { tabs } = buildRoomView({ activities: { installed: [] } }, all);
    expect(tabs[0]).toEqual({ ...ROOM_TAB });
  });

  it("hides the game tab when a room has no games", () => {
    // A room built for a meeting should not show an empty arcade.
    const room = { activities: { installed: [{ id: "whiteboard", enabled: true }] } };
    const { tabs } = buildRoomView(room, all);
    expect(tabs.map((t) => t.id)).toEqual(["room", "board"]);
  });

  it("hides the board tab when a room has no whiteboard", () => {
    const room = { activities: { installed: [{ id: "ludo", enabled: true }] } };
    const { tabs } = buildRoomView(room, all);
    expect(tabs.map((t) => t.id)).toEqual(["room", "game"]);
  });

  it("leaves only the room tab when every activity is uninstalled", () => {
    // `configured` marks this as a deliberate chat-only room rather than a
    // never-configured legacy one, which would resolve to everything.
    const room = { activities: { installed: [], configured: true } };
    expect(buildRoomView(room, all).tabs.map((t) => t.id)).toEqual(["room"]);
  });

  it("drops an activity the client cannot render", () => {
    // A manifest can exist on the server before the client ships a panel;
    // showing a tab that renders nothing is worse than not showing it.
    const noGames = (id) => id !== "ludo" && id !== "skribbl" && id !== "chess"
      && id !== "uno" && id !== "typing" && id !== "bingo" && id !== "kart";
    const { tabs } = buildRoomView({}, noGames);
    expect(tabs.map((t) => t.id)).toEqual(["room", "board"]);
  });

  it("ignores a disabled activity", () => {
    const room = { activities: { installed: [{ id: "whiteboard", enabled: false }, { id: "ludo", enabled: true }] } };
    expect(buildRoomView(room, all).tabs.map((t) => t.id)).toEqual(["room", "game"]);
  });

  it("survives a room referencing a plugin this build does not have", () => {
    const room = { activities: { installed: [{ id: "from-the-future", enabled: true }] } };
    expect(() => buildRoomView(room, all)).not.toThrow();
    expect(buildRoomView(room, all).tabs.map((t) => t.id)).toEqual(["room"]);
  });

  it("tolerates a null/undefined room while it loads", () => {
    for (const room of [null, undefined]) {
      expect(buildRoomView(room, all).tabs.map((t) => t.id)).toEqual(["room", "board", "game"]);
    }
  });
});

describe("describe() — activity announcements", () => {
  const { describe: d } = buildRoomView({}, all);

  it("builds the phrase from the manifest name and icon", () => {
    expect(d("ludo")).toBe("started Ludo 🎲");
    expect(d("kart")).toBe("started Smash Karts 3D 🏎️");
    expect(d("skribbl")).toBe("started Draw & Guess 🎨");
  });

  it("keeps the call wording, which is core and has no manifest", () => {
    // Regression guard: routing `call` through the manifest lookup would
    // silently degrade this to "started an activity".
    expect(d("call")).toBe(CORE_ACTIVITIES.call.label);
    expect(d("call")).toMatch(/call/i);
  });

  it("maps the legacy 'board' id onto the whiteboard manifest", () => {
    // Older clients/servers emit "board" rather than "whiteboard".
    expect(d("board")).toBe("started Whiteboard 🖊️");
  });

  it("degrades readably for an id it has never heard of", () => {
    expect(d("quantum-chess-9000")).toBe("started an activity");
  });

  it("covers every legacy activity id with a real phrase", () => {
    // Whatever an old server announces, the user must not see the fallback.
    for (const id of LEGACY_ACTIVITY_IDS) {
      expect(d(id)).not.toBe("started an activity");
      expect(d(id)).toMatch(/^started .+/);
    }
  });
});

describe("tabFor() — where an announcement takes you", () => {
  const { tabFor } = buildRoomView({}, all);

  it("sends games to the game tab", () => {
    for (const id of ["ludo", "chess", "uno", "typing", "bingo", "kart", "skribbl"]) {
      expect(tabFor(id)).toBe("game");
    }
  });

  it("sends the whiteboard to the board tab, under either id", () => {
    expect(tabFor("whiteboard")).toBe("board");
    expect(tabFor("board")).toBe("board");
  });

  it("keeps calls on the room tab", () => {
    // `call` is CORE and has no manifest — routing it through the manifest
    // lookup would silently degrade it to the unknown-id fallback.
    expect(tabFor("call")).toBe("room");
  });

  it("routes the overlay surface to the room tab", () => {
    // No plugin currently uses `overlay` (poll did, before it went back to
    // being core), so this asserts the mapping rather than a live plugin —
    // otherwise the next overlay plugin inherits an untested path.
    expect(SURFACE_TAB.overlay).toBe("room");
  });

  it("falls back to the room tab for an unknown id", () => {
    expect(tabFor("nonsense")).toBe("room");
  });

  it("maps every surface to a real tab", () => {
    // "tab" is the per-plugin surface: the destination is tab:<id>, computed
    // per plugin rather than fixed, so it is the one value that is a prefix
    // rather than a literal tab id.
    for (const tab of Object.values(SURFACE_TAB)) {
      expect(["room", "board", "game", "tab"]).toContain(tab);
    }
  });
});

describe("activity grouping", () => {
  it("separates board, game and overlay activities", () => {
    const v = buildRoomView({}, all);
    expect(v.boardActivity.id).toBe("whiteboard");
    expect(v.gameActivities.map((a) => a.id).sort()).toEqual(
      ["bingo", "chess", "kart", "ludo", "skribbl", "typing", "uno"]
    );
    // Empty until a plugin uses the overlay surface again — poll was the only
    // one and is core now. Asserted rather than dropped so the grouping is
    // still covered when one arrives.
    expect(v.overlayActivities).toEqual([]);
  });

  it("returns every usable activity with its manifest attached", () => {
    const v = buildRoomView({}, all);
    expect(v.activities).toHaveLength(LEGACY_ACTIVITY_IDS.length);
    for (const a of v.activities) {
      expect(a.manifest).toBeTruthy();
      expect(a.manifest.id).toBe(a.id);
    }
  });
});
