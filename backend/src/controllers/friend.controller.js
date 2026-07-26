import mongoose from "mongoose";
import { User } from "../models/User.js";
import { Room } from "../models/Room.js";
import { Friendship } from "../models/Friendship.js";
import { isRoomMember } from "../utils/roomAccess.js";
import { io } from "../sockets/index.js";

const publicUser = (u) => ({ id: u._id, name: u.name, avatarUrl: u.avatarUrl });
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const err = (message, statusCode) => {
  const e = new Error(message);
  e.statusCode = statusCode;
  return e;
};

// Is this user connected right now? (has at least one live socket in their
// personal room). io is undefined under tests → treated as offline.
async function isOnline(userId) {
  if (!io) return false;
  const sockets = await io.in(`user:${userId}`).fetchSockets();
  return sockets.length > 0;
}

// The friendship (if any) between me and another user, in either direction.
function betweenQuery(a, b) {
  return { $or: [{ requester: a, recipient: b }, { requester: b, recipient: a }] };
}

/**
 * GET /friends/search?q=  — find people to add (by name or email), annotated
 * with our current relationship so the UI shows the right button.
 */
export async function searchUsers(req, res, next) {
  try {
    const q = (req.query.q || "").trim();
    if (q.length < 2) return res.json({ success: true, data: { users: [] } });

    const rx = new RegExp(escapeRegex(q), "i");
    const users = await User.find({
      _id: { $ne: req.user.id },
      isGuest: { $ne: true },
      $or: [{ name: rx }, { email: rx }],
    })
      .select("name avatarUrl")
      .limit(10)
      .lean();

    // Annotate each with relationship status vs me.
    const links = await Friendship.find({
      $or: [{ requester: req.user.id }, { recipient: req.user.id }],
    }).lean();
    const relOf = (uid) => {
      const f = links.find(
        (l) =>
          (l.requester.toString() === uid && l.recipient.toString() === req.user.id) ||
          (l.recipient.toString() === uid && l.requester.toString() === req.user.id)
      );
      if (!f) return "none";
      if (f.status === "accepted") return "friends";
      return f.requester.toString() === req.user.id ? "outgoing" : "incoming";
    };

    res.json({
      success: true,
      data: { users: users.map((u) => ({ ...publicUser(u), relationship: relOf(u._id.toString()) })) },
    });
  } catch (error) {
    next(error);
  }
}

/** POST /friends/request { userId } — send a friend request. */
export async function sendRequest(req, res, next) {
  try {
    const { userId } = req.body;
    if (!mongoose.isValidObjectId(userId)) throw err("Invalid user", 400);
    if (userId === req.user.id) throw err("You can't friend yourself", 400);

    const target = await User.findById(userId).select("name isGuest");
    if (!target || target.isGuest) throw err("User not found", 404);

    const existing = await Friendship.findOne(betweenQuery(req.user.id, userId));
    if (existing) {
      throw err(existing.status === "accepted" ? "You're already friends" : "A request is already pending", 409);
    }

    await Friendship.create({ requester: req.user.id, recipient: userId, status: "pending" });

    // Real-time nudge so the recipient's request badge updates live.
    const me = await User.findById(req.user.id).select("name avatarUrl");
    io?.to(`user:${userId}`).emit("friend:request", { from: publicUser(me) });

    res.status(201).json({ success: true, message: "Friend request sent" });
  } catch (error) {
    next(error);
  }
}

/** GET /friends — my accepted friends (+ online status). */
export async function listFriends(req, res, next) {
  try {
    const links = await Friendship.find({
      status: "accepted",
      $or: [{ requester: req.user.id }, { recipient: req.user.id }],
    })
      .populate("requester", "name avatarUrl")
      .populate("recipient", "name avatarUrl")
      .lean();

    const friends = await Promise.all(
      links.map(async (l) => {
        const other = l.requester._id.toString() === req.user.id ? l.recipient : l.requester;
        return { ...publicUser(other), online: await isOnline(other._id.toString()) };
      })
    );
    friends.sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));

    res.json({ success: true, data: { friends } });
  } catch (error) {
    next(error);
  }
}

/** GET /friends/requests — pending, split into incoming and outgoing. */
export async function listRequests(req, res, next) {
  try {
    const pending = await Friendship.find({
      status: "pending",
      $or: [{ requester: req.user.id }, { recipient: req.user.id }],
    })
      .populate("requester", "name avatarUrl")
      .populate("recipient", "name avatarUrl")
      .lean();

    const incoming = pending
      .filter((f) => f.recipient._id.toString() === req.user.id)
      .map((f) => ({ id: f._id, from: publicUser(f.requester) }));
    const outgoing = pending
      .filter((f) => f.requester._id.toString() === req.user.id)
      .map((f) => ({ id: f._id, to: publicUser(f.recipient) }));

    res.json({ success: true, data: { incoming, outgoing } });
  } catch (error) {
    next(error);
  }
}

/** POST /friends/requests/:id/accept — accept an incoming request. */
export async function acceptRequest(req, res, next) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) throw err("Request not found", 404);
    const f = await Friendship.findOne({ _id: req.params.id, recipient: req.user.id, status: "pending" });
    if (!f) throw err("Request not found", 404);

    f.status = "accepted";
    await f.save();

    const me = await User.findById(req.user.id).select("name avatarUrl");
    io?.to(`user:${f.requester}`).emit("friend:accepted", { by: publicUser(me) });

    res.json({ success: true, message: "Friend request accepted" });
  } catch (error) {
    next(error);
  }
}

/**
 * DELETE /friends/requests/:id — decline an incoming request OR cancel an
 * outgoing one (whichever this pending row is, as long as I'm involved).
 */
export async function declineRequest(req, res, next) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) throw err("Request not found", 404);
    const f = await Friendship.findOneAndDelete({
      _id: req.params.id,
      status: "pending",
      $or: [{ recipient: req.user.id }, { requester: req.user.id }],
    });
    if (!f) throw err("Request not found", 404);
    res.json({ success: true, message: "Request removed" });
  } catch (error) {
    next(error);
  }
}

/** DELETE /friends/:userId — unfriend. */
export async function removeFriend(req, res, next) {
  try {
    if (!mongoose.isValidObjectId(req.params.userId)) throw err("Not found", 404);
    await Friendship.findOneAndDelete({
      status: "accepted",
      ...betweenQuery(req.user.id, req.params.userId),
    });
    res.json({ success: true, message: "Removed" });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /friends/invite { friendId, roomId } — invite a friend to a room you're
 * in. Fire-and-forget real-time: the friend gets a tap-to-join notification if
 * they're online (offline friends simply miss it — no persistent invite yet).
 */
export async function inviteToRoom(req, res, next) {
  try {
    const { friendId, roomId } = req.body;
    if (!mongoose.isValidObjectId(friendId) || !mongoose.isValidObjectId(roomId)) throw err("Invalid invite", 400);

    const friendship = await Friendship.findOne({ status: "accepted", ...betweenQuery(req.user.id, friendId) });
    if (!friendship) throw err("You can only invite friends", 403);

    if (!(await isRoomMember(roomId, req.user.id))) throw err("You are not in that room", 403);

    const room = await Room.findById(roomId).select("name code");
    if (!room) throw err("Room not found", 404);

    const me = await User.findById(req.user.id).select("name avatarUrl");
    io?.to(`user:${friendId}`).emit("friend:invite", {
      from: publicUser(me),
      room: { id: room._id, name: room.name, code: room.code },
    });

    res.json({ success: true, message: "Invite sent" });
  } catch (error) {
    next(error);
  }
}
