/**
 * Shared "can this caller act in this room?" logic, used by REST controllers
 * and both socket handler modules so the rule can't drift between them.
 *
 * Two ways in:
 *   - you're a persistent MEMBER of the room (registered user), OR
 *   - you're a GUEST whose token is scoped to exactly this room (joined via an
 *     invite link). Guests are never added to room.members — their access rides
 *     the `room` claim on their token instead, so nothing to clean up when the
 *     ephemeral guest expires.
 */
import { Room } from "../models/Room.js";

export async function isRoomMember(roomId, userId) {
  const room = await Room.findById(roomId).select("members").lean();
  return Boolean(room && room.members.some((m) => m.toString() === userId));
}

// A guest may only touch the single room their token was minted for.
export function isScopedGuest(user, roomId) {
  return Boolean(user?.isGuest && user.room && String(user.room) === String(roomId));
}

export async function canAccessRoom(user, roomId) {
  return isScopedGuest(user, roomId) || (await isRoomMember(roomId, user.id));
}
