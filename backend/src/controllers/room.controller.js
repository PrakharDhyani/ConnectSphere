import mongoose from "mongoose";
import { Room } from "../models/Room.js";
import { Message } from "../models/Message.js";
import { Report } from "../models/Report.js";
import { io } from "../sockets/index.js";
import { roomKey } from "../sockets/chat.handlers.js";
import { isScopedGuest, canAccessRoom } from "../utils/roomAccess.js";
import { getPlugin, coerceConfig, isValidPurpose, resolveInstalled } from "../../../shared/activities/index.js";

// Lightweight shape for lists/create/join — one place decides what a room looks
// like to clients.
function toSafeRoom(room) {
  return {
    id: room._id,
    name: room.name,
    code: room.code,
    owner: room.owner,
    visibility: room.visibility || "private",
    memberCount: room.members.length,
    createdAt: room.createdAt,
  };
}

// What a NON-member may see about a public room — note: no invite `code`
// (discovery must not leak the private-style door key).
function toPublicRoom(room) {
  return {
    id: room._id,
    name: room.name,
    visibility: "public",
    memberCount: room.members.length,
    createdAt: room.createdAt,
  };
}

// Detailed shape for the room page — includes the full member list (populated)
// and whether the caller owns it, so the UI can show owner-only actions.
function toRoomDetail(room, userId) {
  const ownerId = room.owner.toString();
  const isOwner = ownerId === userId;
  return {
    id: room._id,
    name: room.name,
    code: room.code,
    owner: ownerId,
    isOwner,
    createdAt: room.createdAt,
    memberCount: room.members.length,
    slowModeSec: room.slowModeSec || 0,
    visibility: room.visibility || "private",
    // House rules are visible to EVERY member (that is the point) — only
    // editing them is owner-gated.
    rules: room.rules?.items || [],
    rulesUpdatedAt: room.rules?.updatedAt,
    // Activities drive the room's tabs. Sent as the raw stored shape (not
    // resolved) so the client applies the SAME legacy fallback the server
    // would — one rule, in shared/, rather than two that can drift.
    //
    // Sent whenever the room has been CONFIGURED, even if the list is empty:
    // omitting it there would make a deliberately chat-only room look legacy
    // to the client and hand every activity back.
    activities: room.activities?.configured || room.activities?.installed?.length
      ? {
          installed: room.activities.installed || [],
          active: room.activities.active ?? null,
          configured: Boolean(room.activities.configured),
        }
      : undefined,
    purpose: room.purpose?.kind ? { kind: room.purpose.kind, text: room.purpose.text } : undefined,
    // The ban list is owner-only information (needed for the unban UI).
    banned: isOwner
      ? (room.banned || []).map((b) => ({ id: b.user, name: b.name, reason: b.reason, at: b.at }))
      : undefined,
    members: room.members.map((m) => ({
      id: m._id,
      name: m.name,
      avatarUrl: m.avatarUrl,
      isOwner: m._id.toString() === ownerId,
    })),
  };
}

// ── Moderation ───────────────────────────────────────────────────────────────

// Shared kick mechanics: drop membership, force their sockets out of the
// socket.io room (so games/chat stop instantly), and tell their clients.
async function ejectFromRoom(room, userId, reason) {
  room.members = room.members.filter((m) => m.toString() !== userId);
  await room.save();
  const rk = roomKey(room._id);
  io?.to(`user:${userId}`).emit("room:kicked", {
    roomId: room._id.toString(),
    roomName: room.name,
    // Telling someone WHY they were removed is the difference between
    // moderation and a mystery.
    reason: reason || undefined,
  });
  io?.in(`user:${userId}`).socketsLeave(rk);
  io?.to(rk).emit("room:members-changed", { roomId: room._id.toString() });
}

function assertOwnerAction(room, req, targetId) {
  if (room.owner.toString() !== req.user.id) throw forbidden("Only the room owner can do that");
  if (!targetId || !mongoose.isValidObjectId(targetId)) throw notFound();
  if (targetId === req.user.id) {
    const err = new Error("You can't moderate yourself");
    err.statusCode = 400;
    throw err;
  }
}

// POST /:id/kick — remove a member; they may rejoin (invite code / public).
export async function kickMember(req, res, next) {
  try {
    const room = await loadRoom(req.params.id);
    const { userId, reason } = req.body;
    assertOwnerAction(room, req, userId);
    await ejectFromRoom(room, userId, String(reason || "").slice(0, 300));
    res.json({ success: true, message: "Member removed" });
  } catch (error) {
    next(error);
  }
}

// POST /:id/ban — kick + never come back (blocks code-join, public-join and
// socket access via canAccessRoom).
export async function banMember(req, res, next) {
  try {
    const room = await loadRoom(req.params.id, { populateMembers: true });
    const { userId, reason } = req.body;
    assertOwnerAction(room, req, userId);
    const target = room.members.find((m) => m._id.toString() === userId);
    const why = String(reason || "").slice(0, 300);
    if (!room.banned.some((b) => b.user?.toString() === userId)) {
      room.banned.push({ user: userId, name: target?.name || "Unknown", reason: why, at: new Date() });
    }
    room.members = room.members.map((m) => m._id); // depopulate for eject's save
    await ejectFromRoom(room, userId, why);
    res.json({ success: true, message: "Member banned" });
  } catch (error) {
    next(error);
  }
}

/**
 * PUT /:id/rules  { items: string[] }
 *
 * Owner writes the house rules. Bumping `updatedAt` is what re-prompts
 * members to re-read them — the client stores the version it acknowledged, so
 * this needs no per-user rows.
 */
export async function setRoomRules(req, res, next) {
  try {
    const room = await loadRoom(req.params.id);
    if (room.owner.toString() !== req.user.id) throw forbidden("Only the room owner can do that");

    const items = (Array.isArray(req.body.items) ? req.body.items : [])
      .map((r) => String(r || "").trim().slice(0, 200))
      .filter(Boolean)
      .slice(0, 20);

    room.rules = { items: items.length ? items : undefined, updatedAt: new Date(), updatedBy: req.user.id };
    await room.save();

    io?.to(roomKey(room._id)).emit("room:rules-changed", {
      roomId: room._id.toString(),
      rules: items,
      updatedAt: room.rules.updatedAt,
    });
    res.json({ success: true, data: { rules: items, updatedAt: room.rules.updatedAt } });
  } catch (error) {
    next(error);
  }
}

// ── Activity management ──────────────────────────────────────────────────────

/**
 * PUT /:id/activities — install, remove and reconfigure a room's activities.
 *
 * Owner-only. The whole set is replaced in one call rather than exposing
 * add/remove/patch endpoints: the client already holds the full list, and a
 * single write means two people toggling activities at once cannot interleave
 * into a half-applied state.
 *
 * MATERIALIZATION: a room created before plugins existed has no `activities`
 * field and resolves to "everything" at read time. The first edit turns that
 * implicit set into an explicit one — which is exactly the moment the user has
 * expressed an opinion about it. Nothing is migrated in bulk, ever.
 */
export async function setRoomActivities(req, res, next) {
  try {
    const room = await loadRoom(req.params.id);
    if (room.owner.toString() !== req.user.id) throw forbidden("Only the room owner can do that");

    const requested = Array.isArray(req.body.activities) ? req.body.activities : null;
    if (!requested) {
      const err = new Error("activities must be an array");
      err.statusCode = 400;
      throw err;
    }
    if (requested.length > 32) {
      const err = new Error("Too many activities");
      err.statusCode = 400;
      throw err;
    }

    // What the room has today — legacy rooms resolve to the full default set,
    // so config a user set earlier is preserved across an edit.
    const existing = new Map(resolveInstalled(room).map((a) => [a.id, a]));
    /**
     * Install PROVENANCE (who added it, when) has to come from the raw stored
     * subdocuments, not from resolveInstalled() — that normalises entries down
     * to {id, config, enabled, version} and drops addedBy/addedAt. Reading it
     * from there silently reset "added" to now on every save, rewriting
     * history for activities that had not changed.
     */
    const priorMeta = new Map((room.activities?.installed || []).map((a) => [a.id, a]));

    const seen = new Set();
    const installed = [];
    for (const entry of requested) {
      const manifest = getPlugin(entry?.id);
      if (!manifest) {
        const err = new Error(`Unknown activity "${entry?.id}"`);
        err.statusCode = 400;
        throw err;
      }
      if (seen.has(manifest.id)) continue;
      seen.add(manifest.id);

      const prior = existing.get(manifest.id);
      const meta = priorMeta.get(manifest.id);
      // Layer: plugin defaults → whatever the room already had → this request.
      // Omitting `config` therefore means "leave it alone", not "reset it".
      const merged = { ...(prior?.config || {}), ...(entry.config || {}) };
      const { config } = coerceConfig(manifest.configSchema, merged);

      installed.push({
        id: manifest.id,
        // Keep the pinned version: a plugin update is an opt-in migration, not
        // something that happens because the owner toggled an unrelated tab.
        version: meta?.version || manifest.version,
        config,
        enabled: entry.enabled !== false,
        addedBy: meta?.addedBy || req.user.id,
        addedAt: meta?.addedAt || new Date(),
      });
    }

    room.activities = room.activities || {};
    room.activities.installed = installed;
    // Marks the room as explicitly configured, so an EMPTY list from here on
    // means "chat only" rather than being mistaken for a legacy room and
    // resolving back to everything.
    room.activities.configured = true;

    // A pointer at something just removed would strand the room on a tab that
    // no longer exists. Clearing it falls back to chat, which always exists.
    const stillThere = installed.some((a) => a.id === room.activities.active && a.enabled);
    if (!stillThere) room.activities.active = null;

    await room.save();

    const payload = {
      roomId: room._id.toString(),
      activities: {
        installed: room.activities.installed,
        active: room.activities.active ?? null,
        configured: true,
      },
    };
    // Everyone in the room needs new tabs immediately — a member staring at a
    // Game tab the owner just removed would get an empty screen on click.
    io?.to(roomKey(room._id)).emit("room:activities-changed", payload);

    res.json({ success: true, data: payload });
  } catch (error) {
    next(error);
  }
}

/**
 * PUT /:id/activities/active — switch the room's foreground activity.
 *
 * NOT owner-only: starting a game is ordinary participation, and gating it
 * behind ownership would make the room worse for no security gain (anyone who
 * can join can already play). Per-activity "who may start this" is a later,
 * finer-grained control.
 */
export async function setActiveActivity(req, res, next) {
  try {
    const room = await loadRoom(req.params.id);
    if (!(await canAccessRoom(req.user, req.params.id))) throw forbidden("Not a member of this room");

    const { activityId } = req.body;
    if (activityId !== null && typeof activityId !== "string") {
      const err = new Error("activityId must be a string or null");
      err.statusCode = 400;
      throw err;
    }

    // null = back to the room's own chat surface, which is always available.
    if (activityId !== null) {
      const entry = resolveInstalled(room).find((a) => a.id === activityId);
      if (!entry || !entry.enabled) {
        const err = new Error("That activity is not available in this room");
        err.statusCode = 400;
        throw err;
      }
    }

    room.activities = room.activities || {};
    room.activities.active = activityId;
    await room.save();

    io?.to(roomKey(room._id)).emit("room:active-activity", {
      roomId: room._id.toString(),
      active: activityId,
      by: { id: req.user.id, name: req.user.name },
    });

    res.json({ success: true, data: { active: activityId } });
  } catch (error) {
    next(error);
  }
}

// POST /:id/unban
export async function unbanMember(req, res, next) {
  try {
    const room = await loadRoom(req.params.id);
    const { userId } = req.body;
    if (room.owner.toString() !== req.user.id) throw forbidden("Only the room owner can do that");
    room.banned = (room.banned || []).filter((b) => b.user?.toString() !== userId);
    await room.save();
    res.json({ success: true, message: "Ban lifted" });
  } catch (error) {
    next(error);
  }
}

// POST /:id/slowmode { seconds } — 0 turns it off; owner is always exempt.
export async function setSlowMode(req, res, next) {
  try {
    const room = await loadRoom(req.params.id);
    if (room.owner.toString() !== req.user.id) throw forbidden("Only the room owner can do that");
    const seconds = Math.max(0, Math.min(120, Math.round(Number(req.body.seconds) || 0)));
    room.slowModeSec = seconds;
    await room.save();
    io?.to(roomKey(room._id)).emit("room:updated", {
      roomId: room._id.toString(),
      slowModeSec: seconds,
    });
    res.json({ success: true, data: { slowModeSec: seconds } });
  } catch (error) {
    next(error);
  }
}

// POST /:id/report { userId, reason } — any member (guests too) may report.
// Duplicate (same reporter→target in this room) within an hour is a no-op.
export async function reportMember(req, res, next) {
  try {
    const room = await loadRoom(req.params.id, { populateMembers: true });
    const allowed =
      isScopedGuest(req.user, req.params.id) ||
      room.members.some((m) => m._id.toString() === req.user.id);
    if (!allowed) throw forbidden("You are not a member of this room");
    const { userId, reason } = req.body;
    if (!userId || !mongoose.isValidObjectId(userId)) throw notFound();
    if (userId === req.user.id) {
      const err = new Error("You can't report yourself");
      err.statusCode = 400;
      throw err;
    }
    const recent = await Report.findOne({
      room: room._id,
      reporter: req.user.id,
      reported: userId,
      createdAt: { $gt: new Date(Date.now() - 3600_000) },
    });
    if (!recent) {
      const target = room.members.find((m) => m._id.toString() === userId);
      await Report.create({
        room: room._id,
        reporter: req.user.id,
        reported: userId,
        reportedName: target?.name,
        reason: String(reason || "").slice(0, 500),
      });
    }
    res.json({ success: true, message: "Report received — thank you" });
  } catch (error) {
    next(error);
  }
}

const notFound = () => {
  const error = new Error("Room not found");
  error.statusCode = 404;
  return error;
};

const forbidden = (message) => {
  const error = new Error(message);
  error.statusCode = 403;
  return error;
};

// Load a room by :id or throw the right error (404 for missing/malformed id).
async function loadRoom(id, { populateMembers = false } = {}) {
  if (!mongoose.isValidObjectId(id)) throw notFound();
  const query = Room.findById(id);
  if (populateMembers) query.populate("members", "name avatarUrl");
  const room = await query;
  if (!room) throw notFound();
  return room;
}

/**
 * Turn the wizard's activity selection into stored installs.
 *
 * TRUST BOUNDARY. Ids and config come from the browser, so:
 *   - an unknown plugin id is a 400, not a silently stored ghost entry
 *   - config is coerced and clamped against the plugin's own configSchema
 *     (unknown keys dropped, numbers clamped, bad types replaced by defaults)
 *   - the version is pinned at install time, so a later plugin update is an
 *     opt-in migration rather than a silent behaviour change
 *
 * Returns null when nothing was selected — the room keeps NO activities field
 * and therefore resolves to the legacy "everything" default, which is exactly
 * what a one-click create should do.
 */
function buildInstalledActivities(activities, userId) {
  if (!Array.isArray(activities) || activities.length === 0) return null;

  const seen = new Set();
  const installed = [];
  for (const entry of activities) {
    const manifest = getPlugin(entry.id);
    if (!manifest) {
      const err = new Error(`Unknown activity "${entry.id}"`);
      err.statusCode = 400;
      throw err;
    }
    if (seen.has(manifest.id)) continue; // duplicates are a client bug, not an error
    seen.add(manifest.id);
    const { config } = coerceConfig(manifest.configSchema, entry.config);
    installed.push({
      id: manifest.id,
      version: manifest.version,
      config,
      enabled: true,
      addedBy: userId,
      addedAt: new Date(),
    });
  }
  return installed.length ? installed : null;
}

export async function createRoom(req, res, next) {
  try {
    const { name, visibility, purpose, activities } = req.body;
    const installed = buildInstalledActivities(activities, req.user.id);

    // Only store a purpose we recognise. "custom" is the one kind that carries
    // free text; for every other kind the text is meaningless, so it is dropped
    // rather than persisted as confusing dead data.
    const purposeDoc = purpose?.kind && isValidPurpose(purpose.kind)
      ? { kind: purpose.kind, text: purpose.kind === "custom" ? (purpose.text || "").slice(0, 200) : undefined }
      : undefined;

    // The 6-char code has a ~1-in-16M collision chance; the unique index
    // catches it (E11000). Retry with a fresh code instead of failing the
    // user's request over cosmic bad luck. A duplicate NAME is also E11000 —
    // but that one is the user's to fix, so it maps to a 409, not a retry.
    let room;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        room = await Room.create({
          name,
          visibility,
          owner: req.user.id,
          ...(purposeDoc ? { purpose: purposeDoc } : {}),
          // `configured: true` because the creator explicitly chose these —
          // see the Room model. Omitted entirely when nothing was selected, so
          // a one-click create still resolves to the legacy "everything".
          ...(installed ? { activities: { installed, active: null, configured: true } } : {}),
        });
        break;
      } catch (err) {
        if (err.code === 11000 && err.keyPattern?.nameLower) {
          const dup = new Error("A room with this name already exists — pick another");
          dup.statusCode = 409;
          throw dup;
        }
        if (err.code !== 11000 || attempt === 2) throw err;
      }
    }

    res.status(201).json({ success: true, data: { room: toSafeRoom(room) } });
  } catch (error) {
    next(error);
  }
}

// Rooms the caller belongs to (owner is always a member — model invariant).
export async function listMyRooms(req, res, next) {
  try {
    const rooms = await Room.find({ members: req.user.id }).sort({ createdAt: -1 });
    res.json({ success: true, data: { rooms: rooms.map(toSafeRoom) } });
  } catch (error) {
    next(error);
  }
}

// Discovery: newest public rooms (capped), safe shape — no invite codes.
export async function listPublicRooms(req, res, next) {
  try {
    const rooms = await Room.find({ visibility: "public" }).sort({ createdAt: -1 }).limit(30);
    res.json({ success: true, data: { rooms: rooms.map(toPublicRoom) } });
  } catch (error) {
    next(error);
  }
}

// POST /:id/join-public — walk into a PUBLIC room without a code. Private
// rooms 404 here (not 403): don't confirm a hidden room exists.
export async function joinPublicRoom(req, res, next) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) throw notFound();
    const target = await Room.findById(req.params.id).select("banned visibility").lean();
    if (!target || target.visibility !== "public") throw notFound();
    if ((target.banned || []).some((b) => b.user?.toString() === req.user.id)) {
      throw forbidden("You are banned from this room");
    }
    const room = await Room.findOneAndUpdate(
      { _id: req.params.id, visibility: "public" },
      { $addToSet: { members: req.user.id } },
      { new: true }
    );
    if (!room) throw notFound();

    io?.to(roomKey(room._id)).emit("room:members-changed", { roomId: room._id.toString() });
    res.json({ success: true, data: { room: toSafeRoom(room) } });
  } catch (error) {
    next(error);
  }
}

export async function getRoom(req, res, next) {
  try {
    const room = await loadRoom(req.params.id, { populateMembers: true });

    // Membership gate. 403, not 404: the room exists, you're just not in it —
    // and the join-by-code flow is the door. Scoped guests are let in too.
    const allowed =
      isScopedGuest(req.user, req.params.id) ||
      room.members.some((m) => m._id.toString() === req.user.id);
    if (!allowed) throw forbidden("You are not a member of this room");

    res.json({ success: true, data: { room: toRoomDetail(room, req.user.id) } });
  } catch (error) {
    next(error);
  }
}

// Join by invite code. Idempotent: joining a room you're already in just
// returns it — the end state ("I'm a member") is what matters.
export async function joinRoom(req, res, next) {
  try {
    const { code } = req.body;

    // Banned users can't walk back in with the code. (Checked before the
    // atomic join; the socket layer re-checks via canAccessRoom anyway.)
    const target = await Room.findOne({ code }).select("banned").lean();
    if (!target) throw notFound();
    if ((target.banned || []).some((b) => b.user?.toString() === req.user.id)) {
      throw forbidden("You are banned from this room");
    }

    // $addToSet = add only if absent (no duplicate memberships), atomically.
    const room = await Room.findOneAndUpdate(
      { code },
      { $addToSet: { members: req.user.id } },
      { new: true }
    );
    if (!room) throw notFound();

    res.json({ success: true, data: { room: toSafeRoom(room) } });
  } catch (error) {
    next(error);
  }
}

// PATCH /:id — owner renames the room. Broadcasts so members currently in the
// room see the new name live.
export async function renameRoom(req, res, next) {
  try {
    const room = await loadRoom(req.params.id);
    if (room.owner.toString() !== req.user.id) {
      throw forbidden("Only the room owner can rename it");
    }

    room.name = req.body.name;
    try {
      await room.save();
    } catch (err) {
      if (err.code === 11000 && err.keyPattern?.nameLower) {
        const dup = new Error("A room with this name already exists — pick another");
        dup.statusCode = 409;
        throw dup;
      }
      throw err;
    }

    io?.to(roomKey(room._id)).emit("room:updated", {
      roomId: room._id.toString(),
      name: room.name,
    });

    res.json({ success: true, data: { room: toSafeRoom(room) } });
  } catch (error) {
    next(error);
  }
}

// POST /:id/leave — a member removes themselves. The owner can't leave (they'd
// orphan the room); they must delete it. Idempotent: leaving a room you're not
// in still ends in the same state, so it succeeds.
export async function leaveRoom(req, res, next) {
  try {
    const room = await loadRoom(req.params.id);
    if (room.owner.toString() === req.user.id) {
      const error = new Error("The owner can't leave — delete the room instead");
      error.statusCode = 400;
      throw error;
    }

    room.members = room.members.filter((m) => m.toString() !== req.user.id);
    await room.save();

    // Hint anyone still in the room to refresh their member list.
    io?.to(roomKey(room._id)).emit("room:members-changed", {
      roomId: room._id.toString(),
    });

    res.json({ success: true, message: "You have left the room" });
  } catch (error) {
    next(error);
  }
}

// DELETE /:id — owner deletes the room and all its messages, and tells any
// connected members the room is gone so their UI can bounce them out.
export async function deleteRoom(req, res, next) {
  try {
    const room = await loadRoom(req.params.id);
    if (room.owner.toString() !== req.user.id) {
      throw forbidden("Only the room owner can delete it");
    }

    await Message.deleteMany({ room: room._id });
    await room.deleteOne();

    io?.to(roomKey(room._id)).emit("room:closed", { roomId: room._id.toString() });

    res.json({ success: true, message: "Room deleted" });
  } catch (error) {
    next(error);
  }
}
