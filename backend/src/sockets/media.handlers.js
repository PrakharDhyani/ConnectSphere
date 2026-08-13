/**
 * WebRTC signaling over Socket.io — the negotiation that sets up mediasoup
 * transports/producers/consumers for a room. (The actual audio/video never
 * touches Socket.io; it flows over the UDP media transports. These events just
 * exchange the setup parameters.)
 *
 * The handshake (client ↔ server), each with an ack callback:
 *   media:getRtpCapabilities (roomId)                 → the router's capabilities
 *   media:createTransport   ({roomId, direction})     → transport params (send or recv)
 *   media:connectTransport  ({..., dtlsParameters})   → completes the DTLS handshake
 *   media:produce           ({..., kind, rtpParameters}) → registers an incoming track;
 *                                                          notifies the room (media:newProducer)
 *   media:getProducers      (roomId)                  → existing producers to consume
 *   media:consume           ({..., producerId, rtpCapabilities}) → an outgoing track
 *   media:resume            ({..., consumerId})       → un-pause a consumer
 *   media:leave             (roomId)                  → tear this peer's media down
 *
 * State: per room we keep one Router + a Map of peers (by socket id); each peer
 * owns its transports/producers/consumers so we can close exactly them on leave
 * or disconnect. Closing a transport closes its producers/consumers for us.
 */
import { getWorker, mediaCodecs } from "../config/mediasoup.js";
import { canAccessRoom } from "../utils/roomAccess.js";
import { allow } from "../utils/socketRate.js";
import { roomKey } from "./chat.handlers.js";
import { Room } from "../models/Room.js";
import { sendPushToUsers } from "../services/push.service.js";
import { logger } from "../utils/logger.js";

// roomId -> { router, peers: Map<socketId, { transports, producers, consumers }> }
const roomsMedia = new Map();

async function getRoomMedia(roomId) {
  let rm = roomsMedia.get(roomId);
  if (!rm) {
    const router = await getWorker().createRouter({ mediaCodecs });
    rm = { router, peers: new Map() };
    roomsMedia.set(roomId, rm);
    logger.info(`🎥 mediasoup router created for room ${roomId}`);
  }
  return rm;
}

function getPeer(rm, socketId, user) {
  let peer = rm.peers.get(socketId);
  if (!peer) {
    peer = {
      transports: new Map(),
      producers: new Map(),
      consumers: new Map(),
      // Identity is carried on the peer so the "who is in this call" roster
      // can be built without touching the database on every join/leave.
      user: user ? { id: user.id, name: user.name, avatarUrl: user.avatarUrl } : null,
    };
    rm.peers.set(socketId, peer);
  } else if (user && !peer.user) {
    peer.user = { id: user.id, name: user.name, avatarUrl: user.avatarUrl };
  }
  return peer;
}

/**
 * Who is currently in a room's call, de-duplicated by user (one person with
 * two tabs is one participant). Exported so the chat handler can answer a
 * late joiner's "is a call running?" question on room:join.
 */
export function callParticipants(roomId) {
  const rm = roomsMedia.get(roomId);
  if (!rm) return [];
  const byUser = new Map();
  for (const peer of rm.peers.values()) {
    if (peer.user) byUser.set(peer.user.id, peer.user);
  }
  return [...byUser.values()];
}

/**
 * Broadcast the call roster to the WHOLE room — not just the people in the
 * call — so everyone sees the "N people in this call · tap to join" banner.
 * This is why it goes to `io.to(roomKey)` rather than `socket.to(...)`.
 */
export function broadcastCallState(io, roomId) {
  const participants = callParticipants(roomId);
  io.to(roomKey(roomId)).emit("call:state", {
    roomId,
    active: participants.length > 0,
    participants,
    count: participants.length,
  });
}

function createWebRtcTransport(router) {
  return router.createWebRtcTransport({
    // 0.0.0.0 = listen on all interfaces; announcedIp is the address we hand to
    // the browser to send media to (127.0.0.1 for local dev; the public IP in prod).
    listenIps: [{ ip: "0.0.0.0", announcedIp: process.env.MEDIASOUP_ANNOUNCED_IP || "127.0.0.1" }],
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
    initialAvailableOutgoingBitrate: 1_000_000,
  });
}

export function registerMediaHandlers(io, socket) {
  const notMember = (cb) => cb?.({ error: "You are not a member of this room" });

  socket.on("media:getRtpCapabilities", async (roomId, cb) => {
    try {
      if (!(await canAccessRoom(socket.user, roomId))) return notMember(cb);
      const rm = await getRoomMedia(roomId);
      cb({ rtpCapabilities: rm.router.rtpCapabilities });
    } catch (err) {
      logger.error("media:getRtpCapabilities failed:", err);
      cb?.({ error: "Could not get capabilities" });
    }
  });

  socket.on("media:createTransport", async ({ roomId, direction }, cb) => {
    try {
      if (!allow(socket, "media:transport", 12, 10_000)) return cb?.({ error: "Too many transports" });
      if (!(await canAccessRoom(socket.user, roomId))) return notMember(cb);
      const rm = await getRoomMedia(roomId);
      const peer = getPeer(rm, socket.id, socket.user);
      const transport = await createWebRtcTransport(rm.router);
      peer.transports.set(transport.id, transport);
      peer.userId = socket.user.id; // so getProducers can label tiles
      socket.data.mediaRoomId = roomId; // remember for disconnect cleanup
      // Tell the WHOLE room someone is now in the call, so the join banner
      // appears for people who are not in it.
      broadcastCallState(io, roomId);

      cb({
        direction,
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
      });
    } catch (err) {
      logger.error("media:createTransport failed:", err);
      cb?.({ error: "Could not create transport" });
    }
  });

  socket.on("media:connectTransport", async ({ roomId, transportId, dtlsParameters }, cb) => {
    try {
      const transport = roomsMedia.get(roomId)?.peers.get(socket.id)?.transports.get(transportId);
      if (!transport) return cb?.({ error: "Transport not found" });
      await transport.connect({ dtlsParameters });
      cb({ ok: true });
    } catch (err) {
      logger.error("media:connectTransport failed:", err);
      cb?.({ error: "Could not connect transport" });
    }
  });

  socket.on("media:produce", async ({ roomId, transportId, kind, rtpParameters, source }, cb) => {
    try {
      const rm = roomsMedia.get(roomId);
      const peer = rm?.peers.get(socket.id);
      const transport = peer?.transports.get(transportId);
      if (!transport) return cb?.({ error: "Transport not found" });

      // `source` (camera | screen) lets clients render a screen share as a big
      // tile instead of another face. Stored on the producer so getProducers
      // can report it to late joiners.
      const src = source === "screen" ? "screen" : "camera";
      const producer = await transport.produce({ kind, rtpParameters, appData: { source: src } });
      peer.producers.set(producer.id, producer);
      producer.on("transportclose", () => peer.producers.delete(producer.id));

      // Tell everyone else in the room there's a new track to consume.
      socket.to(roomKey(roomId)).emit("media:newProducer", {
        producerId: producer.id,
        socketId: socket.id,
        userId: socket.user.id,
        kind,
        source: src,
      });

      cb({ id: producer.id });
    } catch (err) {
      logger.error("media:produce failed:", err);
      cb?.({ error: "Could not produce" });
    }
  });

  // Explicitly close one of this peer's producers (e.g. they stopped screen
  // sharing) — producerclose then notifies everyone consuming it.
  socket.on("media:closeProducer", ({ roomId, producerId }, cb) => {
    const producer = roomsMedia.get(roomId)?.peers.get(socket.id)?.producers.get(producerId);
    if (producer) producer.close();
    cb?.({ ok: true });
  });

  // A peer joining an in-progress call needs everyone already producing.
  socket.on("media:getProducers", (roomId, cb) => {
    const rm = roomsMedia.get(roomId);
    if (!rm) return cb?.({ producers: [] });
    const producers = [];
    for (const [socketId, peer] of rm.peers) {
      if (socketId === socket.id) continue;
      for (const producer of peer.producers.values()) {
        producers.push({
          producerId: producer.id,
          socketId,
          userId: peer.userId,
          kind: producer.kind,
          source: producer.appData?.source || "camera",
        });
      }
    }
    cb({ producers });
  });

  socket.on("media:consume", async ({ roomId, transportId, producerId, rtpCapabilities }, cb) => {
    try {
      const rm = roomsMedia.get(roomId);
      if (!rm) return cb?.({ error: "No media in this room" });
      if (!rm.router.canConsume({ producerId, rtpCapabilities })) {
        return cb?.({ error: "Cannot consume this producer" });
      }
      const peer = rm.peers.get(socket.id);
      const transport = peer?.transports.get(transportId);
      if (!transport) return cb?.({ error: "Transport not found" });

      // Start paused — the client resumes once its <video> is wired up, so no
      // frames are dropped before playback is ready.
      const consumer = await transport.consume({ producerId, rtpCapabilities, paused: true });
      peer.consumers.set(consumer.id, consumer);
      consumer.on("transportclose", () => peer.consumers.delete(consumer.id));
      consumer.on("producerclose", () => {
        peer.consumers.delete(consumer.id);
        socket.emit("media:consumerClosed", { consumerId: consumer.id });
      });

      cb({
        id: consumer.id,
        producerId,
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters,
      });
    } catch (err) {
      logger.error("media:consume failed:", err);
      cb?.({ error: "Could not consume" });
    }
  });

  socket.on("media:resume", async ({ roomId, consumerId }, cb) => {
    try {
      const consumer = roomsMedia.get(roomId)?.peers.get(socket.id)?.consumers.get(consumerId);
      if (!consumer) return cb?.({ error: "Consumer not found" });
      await consumer.resume();
      cb({ ok: true });
    } catch (err) {
      logger.error("media:resume failed:", err);
      cb?.({ error: "Could not resume" });
    }
  });

  function cleanupPeer(roomId) {
    const rm = roomsMedia.get(roomId);
    const peer = rm?.peers.get(socket.id);
    if (!peer) return;
    // Closing transports closes their producers + consumers too.
    for (const transport of peer.transports.values()) transport.close();
    rm.peers.delete(socket.id);
    socket.to(roomKey(roomId)).emit("media:peerLeft", { socketId: socket.id, userId: socket.user.id });
    // Free the router when the last person leaves the call.
    if (rm.peers.size === 0) {
      rm.router.close();
      roomsMedia.delete(roomId);
      logger.info(`🎬 mediasoup router closed for empty room ${roomId}`);
    }
    // Roster changed — refresh everyone's banner (this also clears it when
    // the call empties out).
    broadcastCallState(io, roomId);
  }

  socket.on("media:leave", (roomId, cb) => {
    cleanupPeer(roomId);
    cb?.({ ok: true });
  });

  /** Anyone can ask for the current roster (e.g. right after joining a room). */
  socket.on("call:get", async (roomId, cb) => {
    if (!(await canAccessRoom(socket.user, roomId))) return cb?.({ error: "Not a member" });
    const participants = callParticipants(roomId);
    cb?.({ active: participants.length > 0, participants, count: participants.length });
  });

  /**
   * 📞 Ring specific members into an ongoing call — the Teams "invite" gesture.
   *
   * This is deliberately a DIRECT, per-user event rather than a room
   * broadcast: the whole point is to reach someone who has MUTED the room and
   * would otherwise never see the banner. Being explicitly rung by a person is
   * different from ambient room noise, which is why it is allowed to bypass a
   * mute — and why it is rate-limited, needs the caller to actually be in the
   * call, and only targets people who are already room members.
   */
  socket.on("call:ring", async ({ roomId, userIds } = {}, cb) => {
    try {
      if (!allow(socket, "call:ring", 6, 60_000)) {
        return cb?.({ error: "You're ringing people too quickly" });
      }
      if (!(await canAccessRoom(socket.user, roomId))) return notMember(cb);

      const inCall = callParticipants(roomId).some((p) => p.id === socket.user.id);
      if (!inCall) return cb?.({ error: "Join the call before inviting others" });

      const room = await Room.findById(roomId).select("name members").lean();
      if (!room) return cb?.({ error: "Room not found" });

      const memberIds = new Set(room.members.map((m) => m.toString()));
      const alreadyIn = new Set(callParticipants(roomId).map((p) => p.id));
      const targets = (Array.isArray(userIds) ? userIds : [])
        .map(String)
        .filter((id) => memberIds.has(id) && !alreadyIn.has(id) && id !== socket.user.id)
        .slice(0, 20);

      if (!targets.length) return cb?.({ ok: true, rung: 0 });

      for (const id of targets) {
        io.to(`user:${id}`).emit("call:ring", {
          roomId,
          roomName: room.name,
          from: { id: socket.user.id, name: socket.user.name, avatarUrl: socket.user.avatarUrl },
          participants: callParticipants(roomId),
        });
      }

      // Anyone with no live socket gets a push instead — same reasoning: an
      // explicit invite should reach you even with the tab closed.
      const online = new Set(
        (await io.in(roomKey(roomId)).fetchSockets()).map((s) => s.user.id)
      );
      const offline = targets.filter((id) => !online.has(id));
      if (offline.length) {
        sendPushToUsers(offline, {
          title: `${socket.user.name} is calling you`,
          body: `Join the call in ${room.name}`,
          url: `/room/${roomId}`,
          tag: `ring:${roomId}`,
        }).catch((err) => logger.warn(`ring push failed: ${err.message}`));
      }

      cb?.({ ok: true, rung: targets.length });
    } catch (err) {
      logger.error("call:ring failed:", err);
      cb?.({ error: "Could not invite them" });
    }
  });

  socket.on("disconnect", () => {
    if (socket.data.mediaRoomId) cleanupPeer(socket.data.mediaRoomId);
  });
}
