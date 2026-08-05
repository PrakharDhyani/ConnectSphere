/**
 * Chat event handlers for one connected socket.
 *
 * Socket.io "rooms" (a server-side grouping of sockets) map 1:1 to our app
 * rooms — we prefix the id (`room:<id>`) to avoid clashing with any other
 * grouping. Broadcasting to `room:<id>` reaches exactly the sockets that
 * joined it.
 *
 * Events (client → server), each with an optional ack callback:
 *   room:join   (roomId)          → membership-checked, joins + broadcasts presence
 *   room:leave  (roomId)          → leaves + broadcasts presence
 *   message:send({roomId,text})   → persists + broadcasts message:new
 *   typing      (roomId)          → relays a transient typing ping to others
 *
 * Events (server → client):
 *   message:new       (message)   presence:update ({roomId, users})   typing ({roomId, user})
 */
import { Message } from "../models/Message.js";
import { Room } from "../models/Room.js";
import { Friendship } from "../models/Friendship.js";
import { canAccessRoom } from "../utils/roomAccess.js";
import { allow } from "../utils/socketRate.js";
import { logger } from "../utils/logger.js";
import { sendPushToUsers } from "../services/push.service.js";

const ANNOUNCE_ACTIVITIES = new Set(["call", "board", "skribbl", "ludo", "kart", "chess", "uno", "typing", "bingo", "poll"]);

const PUSH_LABEL = {
  call: "started a call", board: "opened the whiteboard", skribbl: "started Draw & Guess",
  ludo: "started Ludo", kart: "started Smash Karts", chess: "started Chess", uno: "started UNO",
  typing: "started a Typing race", bingo: "started Bingo", poll: "started a poll",
};

// roomId:activity → last push timestamp. In-room toasts are cheap, but a push
// buzzes phones — one per room+activity per minute, no matter how many people
// pile into the same game.
const pushThrottle = new Map();

/**
 * The retention half of `room:announce`: the in-room toast only reaches open
 * tabs, so also Web-Push the actor's FRIENDS who are members of this room but
 * aren't currently in it. Fire-and-forget — never blocks the socket event.
 */
async function pushActivityToAbsentFriends(io, socket, roomId, activity) {
  if (socket.user.isGuest) return; // guests have no friends graph
  const throttleKey = `${roomId}:${activity}`;
  if (Date.now() - (pushThrottle.get(throttleKey) || 0) < 60_000) return;
  pushThrottle.set(throttleKey, Date.now());
  if (pushThrottle.size > 5000) pushThrottle.clear(); // crude but bounded

  const room = await Room.findById(roomId).select("name members").lean();
  if (!room) return;

  const links = await Friendship.find({
    status: "accepted",
    $or: [{ requester: socket.user.id }, { recipient: socket.user.id }],
  }).lean();
  const friendIds = new Set(
    links.map((l) => (l.requester.toString() === socket.user.id ? l.recipient : l.requester).toString())
  );

  // Anyone with a socket in the room already got the live toast.
  const present = new Set((await io.in(roomKey(roomId)).fetchSockets()).map((s) => s.user.id));
  const targets = room.members
    .map((m) => m.toString())
    .filter((id) => friendIds.has(id) && !present.has(id));
  if (!targets.length) return;

  await sendPushToUsers(targets, {
    title: `${socket.user.name} ${PUSH_LABEL[activity] || "started an activity"} in ${room.name}`,
    body: "Tap to jump in 🎉",
    url: `/room/${roomId}`,
    tag: `activity:${roomId}`,
  });
}

// The Socket.io room name for an app room. Exported so REST controllers can
// broadcast to the same group (e.g. "room:closed" when a room is deleted).
export const roomKey = (roomId) => `room:${roomId}`;

// roomId:userId → last chat timestamp, for slow mode.
const slowModeLast = new Map();

// ── Attachment sanitisation ────────────────────────────────────────────────
// The client sends attachment DESCRIPTORS over the socket, so everything here
// is untrusted input. Rules:
//   · uploads (image/video/audio/file) must point at OUR storage — a client
//     can't smuggle an arbitrary third-party URL into a message and use the
//     room as a link-laundering surface;
//   · gifs must be https and come from the GIF provider's CDN, OR be one of
//     our own built-in reactions (lib/localGifs.js), which are self-contained
//     animated SVGs sent as data URIs — those are stored by ID, never by
//     payload, so a client can't smuggle arbitrary markup into the database
//     (an inline <svg> is a script-execution vector, so we never persist one
//     that came from a client);
//   · stickers carry no URL at all (the art is vector code on the client), so
//     only a short id is kept.
const STICKER_IDS = new Set(["love", "laugh", "fire", "kiss", "angry", "gunshot"]);

/**
 * GIF provider CDNs we will store a link to.
 *
 * Exact hosts where they are KNOWN (verified by resolving them), plus a
 * registrable-domain suffix rule for providers whose CDN subdomain we cannot
 * confirm without a production key. Guessing a literal hostname is how the
 * first version of this feature shipped dead URLs — a suffix rule is honest
 * about the uncertainty while still refusing arbitrary third-party hosts.
 *
 * Tenor stays listed so messages sent before its shutdown (30 Jun 2026) keep
 * rendering; new GIFs come from Klipy (keyed) or OtakuGIFs (keyless).
 */
const GIF_HOSTS = new Set([
  "cdn.otakugifs.xyz",                            // verified live
  "media.tenor.com", "c.tenor.com", "tenor.com",  // legacy
]);
// Any subdomain of these — the provider owns the whole domain, and their CDN
// hostname isn't publicly documented.
const GIF_HOST_SUFFIXES = ["klipy.com", "otakugifs.xyz"];

const isAllowedGifHost = (hostname) =>
  GIF_HOSTS.has(hostname) ||
  GIF_HOST_SUFFIXES.some((d) => hostname === d || hostname.endsWith(`.${d}`));
const UPLOAD_KINDS = new Set(["image", "video", "audio", "file"]);
const MAX_ATTACHMENTS = 10;

// Built-in reaction ids — must stay in sync with frontend lib/localGifs.js.
const LOCAL_GIF_IDS = new Set([
  "lg-yes", "lg-no", "lg-lol", "lg-love", "lg-fire", "lg-party",
  "lg-clap", "lg-mind", "lg-cry", "lg-shrug", "lg-think", "lg-wave",
  "lg-gg", "lg-letsgo", "lg-popcorn", "lg-sleep", "lg-typing", "lg-100",
  "lg-bday", "lg-thanks", "lg-sorry", "lg-cool", "lg-scared", "lg-eyes",
]);

// Our own storage origin(s) — whatever the browser is told to load from.
function storageOrigins() {
  return [process.env.S3_PUBLIC_URL, process.env.S3_ENDPOINT]
    .filter(Boolean)
    .map((u) => {
      try { return new URL(u).origin; } catch { return null; }
    })
    .filter(Boolean);
}

const clip = (v, max) => (typeof v === "string" ? v.slice(0, max) : undefined);
const posInt = (v) => (Number.isFinite(v) && v >= 0 ? Math.floor(v) : undefined);

function sanitizeAttachments(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const ours = storageOrigins();
  const out = [];

  for (const a of raw.slice(0, MAX_ATTACHMENTS)) {
    if (!a || typeof a !== "object") continue;

    if (a.kind === "sticker") {
      if (!STICKER_IDS.has(a.stickerId)) continue;
      out.push({ kind: "sticker", stickerId: a.stickerId });
      continue;
    }

    // Built-in reaction GIF: keep only the id and drop the data-URI payload
    // entirely — the client re-renders the art from its own registry. Storing
    // client-supplied SVG markup would be an XSS foothold.
    if (a.kind === "gif" && LOCAL_GIF_IDS.has(a.gifId)) {
      out.push({ kind: "gif", gifId: a.gifId, name: clip(a.name, 300) });
      continue;
    }

    let url;
    try { url = new URL(String(a.url)); } catch { continue; }

    if (a.kind === "gif") {
      if (url.protocol !== "https:" || !isAllowedGifHost(url.hostname)) continue;
      out.push({
        kind: "gif",
        url: url.href.slice(0, 2000),
        name: clip(a.name, 300),
        width: posInt(a.width),
        height: posInt(a.height),
      });
      continue;
    }

    if (!UPLOAD_KINDS.has(a.kind)) continue;
    if (ours.length && !ours.includes(url.origin)) continue; // not from our storage
    const entry = {
      kind: a.kind,
      url: url.href.slice(0, 2000),
      name: clip(a.name, 300),
      mime: clip(a.mime, 150),
      size: posInt(a.size),
    };

    // A custom sticker is just an uploaded PNG flagged for smaller rendering.
    if (a.isSticker === true && a.kind === "image") entry.isSticker = true;

    // Voice note extras (audio only) — the waveform is cosmetic, so it is
    // clamped rather than rejected: 64 small ints, each 0..100.
    if (a.kind === "audio" && a.voice) {
      entry.voice = true;
      entry.durationMs = posInt(a.durationMs);
      if (Array.isArray(a.waveform)) {
        entry.waveform = a.waveform
          .slice(0, 64)
          .map((n) => Math.max(0, Math.min(100, Math.round(Number(n) || 0))));
      }
    }

    // View-once: only meaningful for visual media. `viewedBy` is server-owned
    // state — never trust a client-supplied value for it.
    if (a.viewOnce === true && (a.kind === "image" || a.kind === "video")) {
      entry.viewOnce = true;
      entry.viewedBy = [];
    }

    out.push(entry);
  }
  return out;
}

/**
 * What a given viewer is allowed to see of a message. View-once media is
 * stripped of its url once that viewer has opened it (or, for the sender's own
 * copy, once anyone has) so the history API can never hand back a spent link.
 */
export function redactForViewer(message, viewerId) {
  const attachments = (message.attachments || []).map((a) => {
    const raw = a.toObject ? a.toObject() : { ...a };
    if (!raw.viewOnce) return raw;
    const viewed = (raw.viewedBy || []).map(String);
    const isSender = String(message.sender?._id || message.sender) === String(viewerId);
    // The sender sees "opened by N", never the media again; viewers lose it
    // after their own view.
    const spent = isSender ? viewed.length > 0 : viewed.includes(String(viewerId));
    return {
      ...raw,
      url: spent ? undefined : raw.url,
      viewedCount: viewed.length,
      spent,
      viewedBy: undefined, // never leak the roster of who opened it
    };
  });
  return attachments;
}

// roomId → Map<userId, name> of members currently recording the call. The
// indicator is a TRANSPARENCY feature: everyone in the room must always know
// a recording is happening, so state changes broadcast to the whole room.
const recordersByRoom = new Map();

function recorderList(roomId) {
  const m = recordersByRoom.get(roomId);
  return m ? [...m.entries()].map(([id, name]) => ({ id, name })) : [];
}

function broadcastRecorders(io, roomId) {
  io.to(roomKey(roomId)).emit("recording:changed", {
    roomId,
    recorders: recorderList(roomId),
  });
}

// Everyone currently connected to a room, de-duplicated by user (one person
// can have several tabs = several sockets, but shows up once).
async function presenceList(io, roomId) {
  const sockets = await io.in(roomKey(roomId)).fetchSockets();
  const byUser = new Map();
  for (const s of sockets) {
    byUser.set(s.user.id, { id: s.user.id, name: s.user.name, avatarUrl: s.user.avatarUrl });
  }
  return [...byUser.values()];
}

async function broadcastPresence(io, roomId) {
  io.to(roomKey(roomId)).emit("presence:update", {
    roomId,
    users: await presenceList(io, roomId),
  });
}

export function registerChatHandlers(io, socket) {
  socket.on("room:join", async (roomId, ack) => {
    try {
      if (!(await canAccessRoom(socket.user, roomId))) {
        return ack?.({ ok: false, error: "You are not a member of this room" });
      }
      socket.join(roomKey(roomId));
      await broadcastPresence(io, roomId);
      // Late joiners must learn about in-progress recordings immediately.
      ack?.({ ok: true, recorders: recorderList(roomId) });
    } catch (err) {
      logger.error("room:join failed:", err);
      ack?.({ ok: false, error: "Could not join room" });
    }
  });

  socket.on("room:leave", async (roomId, ack) => {
    socket.leave(roomKey(roomId));
    const rec = recordersByRoom.get(roomId);
    if (rec?.delete(socket.user.id)) broadcastRecorders(io, roomId);
    await broadcastPresence(io, roomId);
    ack?.({ ok: true });
  });

  // Toggle my "recording" indicator for a room (client-side recorder).
  socket.on("recording:set", async ({ roomId, on } = {}, ack) => {
    if (!roomId || !socket.rooms.has(roomKey(roomId))) return ack?.({ ok: false });
    if (!(await canAccessRoom(socket.user, roomId))) return ack?.({ ok: false });
    let rec = recordersByRoom.get(roomId);
    if (!rec) {
      rec = new Map();
      recordersByRoom.set(roomId, rec);
    }
    if (on) rec.set(socket.user.id, socket.user.name);
    else rec.delete(socket.user.id);
    if (rec.size === 0) recordersByRoom.delete(roomId);
    broadcastRecorders(io, roomId);
    ack?.({ ok: true });
  });

  socket.on("message:send", async (payload, ack) => {
    try {
      const roomId = payload?.roomId;
      const text = (payload?.text || "").trim();
      const attachments = sanitizeAttachments(payload?.attachments);
      if (!roomId || (!text && attachments.length === 0)) {
        return ack?.({ ok: false, error: "Message cannot be empty" });
      }
      if (text.length > 2000) return ack?.({ ok: false, error: "Message is too long (max 2000)" });
      if (!allow(socket, "msg", 15, 10_000)) return ack?.({ ok: false, error: "Slow down a moment" });

      // Re-check membership on every send — the socket could have been kicked,
      // or is replaying a stale roomId. Never trust the client's claim.
      if (!(await canAccessRoom(socket.user, roomId))) {
        return ack?.({ ok: false, error: "You are not a member of this room" });
      }

      // Slow mode: non-owners get one message per slowModeSec. The clock is an
      // in-memory map — per-process is fine, this is friction not security.
      const roomDoc = await Message.db.model("Room").findById(roomId).select("slowModeSec owner").lean();
      if (roomDoc?.slowModeSec > 0 && roomDoc.owner.toString() !== socket.user.id) {
        const key = `${roomId}:${socket.user.id}`;
        const last = slowModeLast.get(key) || 0;
        const waitMs = roomDoc.slowModeSec * 1000 - (Date.now() - last);
        if (waitMs > 0) {
          return ack?.({ ok: false, error: `Slow mode — wait ${Math.ceil(waitMs / 1000)}s` });
        }
        slowModeLast.set(key, Date.now());
        if (slowModeLast.size > 5000) slowModeLast.clear(); // crude but bounded
      }

      const doc = await Message.create({
        room: roomId,
        sender: socket.user.id,
        text,
        ...(attachments.length ? { attachments } : {}),
      });
      const message = {
        id: doc._id.toString(),
        roomId,
        text: doc.text,
        attachments: doc.attachments || [],
        createdAt: doc.createdAt,
        sender: { id: socket.user.id, name: socket.user.name, avatarUrl: socket.user.avatarUrl },
      };

      // A view-once url must never ride the broadcast — recipients fetch it
      // through POST /messages/:id/view, which is what actually consumes the
      // view. Sending the url here would let any client cache it forever.
      const hasViewOnce = (doc.attachments || []).some((a) => a.viewOnce);
      if (hasViewOnce) {
        const safe = {
          ...message,
          attachments: message.attachments.map((a) => {
            const raw = a.toObject ? a.toObject() : { ...a };
            return raw.viewOnce
              ? { ...raw, url: undefined, viewedBy: undefined, viewedCount: 0, spent: false }
              : raw;
          }),
        };
        io.to(roomKey(roomId)).emit("message:new", safe);
        ack?.({ ok: true, message: safe });
        return;
      }

      io.to(roomKey(roomId)).emit("message:new", message);
      ack?.({ ok: true, message });
    } catch (err) {
      logger.error("message:send failed:", err);
      ack?.({ ok: false, error: "Could not send message" });
    }
  });

  // Activity announcements — "X started a Ludo game", "X opened the whiteboard",
  // "X started the call". Relayed to everyone in the room except the sender so
  // their UI can pop a toast. Purely a notification; carries no trust.
  socket.on("room:announce", ({ roomId, activity } = {}) => {
    if (!roomId || !socket.rooms.has(roomKey(roomId)) || !ANNOUNCE_ACTIVITIES.has(activity)) return;
    if (!allow(socket, "announce", 5, 10_000)) return;
    socket.to(roomKey(roomId)).emit("room:notify", {
      activity, // "call" | "board" | "skribbl" | "ludo"
      name: socket.user.name,
      userId: socket.user.id,
    });
    // Beyond the open tab: Web Push the room's absent friends (no await).
    pushActivityToAbsentFriends(io, socket, roomId, activity).catch((err) =>
      logger.warn(`activity push failed: ${err.message}`)
    );
  });

  // Transient — never stored. `socket.to` = everyone in the room EXCEPT sender.
  socket.on("typing", (roomId) => {
    if (!roomId || !allow(socket, "typing", 10, 5000)) return;
    socket.to(roomKey(roomId)).emit("typing", {
      roomId,
      user: { id: socket.user.id, name: socket.user.name },
    });
  });

  // `disconnecting` fires while socket.rooms still lists the rooms. We defer the
  // presence recompute to the next tick so the socket has actually left first,
  // otherwise it would still count itself as present.
  socket.on("disconnecting", () => {
    const rooms = [...socket.rooms].filter((k) => k.startsWith("room:"));
    setImmediate(() => {
      for (const key of rooms) {
        const roomId = key.slice("room:".length);
        // A recorder that vanishes must not leave a stuck 🔴 indicator.
        const rec = recordersByRoom.get(roomId);
        if (rec?.delete(socket.user.id)) {
          if (rec.size === 0) recordersByRoom.delete(roomId);
          broadcastRecorders(io, roomId);
        }
        broadcastPresence(io, roomId).catch(() => {});
      }
    });
  });
}
