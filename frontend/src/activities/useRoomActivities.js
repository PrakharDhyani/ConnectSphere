/**
 * Resolves a room's activities into what the room UI needs: which tabs to
 * show, and how to describe an activity that just started.
 *
 * This replaces three hand-maintained lists that used to live in RoomPage:
 *   - the literal tab array  [["room","💬 Room"],["board",…],["game",…]]
 *   - ACT_LABEL   id -> "started Ludo 🎲"
 *   - ACT_VIEW    id -> which tab to open
 *
 * All three had to be edited to add a game. Now the name and icon come from
 * the manifest and the destination from `surface`, so a plugin shows up in the
 * UI by existing.
 *
 * The logic itself lives in shared/activities/room-view.js — pure, and
 * therefore covered by the backend test suite (the frontend has no runner).
 * This file is only the React binding.
 */
import { useMemo } from "react";
import { buildRoomView, ROOM_TAB } from "@shared/activities/room-view.js";
import { hasClientModule } from "./registry.jsx";

export { ROOM_TAB };

export function useRoomActivities(room) {
  return useMemo(() => buildRoomView(room, hasClientModule), [room]);
}
