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
import { roomKey } from "./chat.handlers.js";
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

function getPeer(rm, socketId) {
  let peer = rm.peers.get(socketId);
  if (!peer) {
    peer = { transports: new Map(), producers: new Map(), consumers: new Map() };
    rm.peers.set(socketId, peer);
  }
  return peer;
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
      if (!(await canAccessRoom(socket.user, roomId))) return notMember(cb);
      const rm = await getRoomMedia(roomId);
      const peer = getPeer(rm, socket.id);
      const transport = await createWebRtcTransport(rm.router);
      peer.transports.set(transport.id, transport);
      peer.userId = socket.user.id; // so getProducers can label tiles
      socket.data.mediaRoomId = roomId; // remember for disconnect cleanup

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
  }

  socket.on("media:leave", (roomId, cb) => {
    cleanupPeer(roomId);
    cb?.({ ok: true });
  });

  socket.on("disconnect", () => {
    if (socket.data.mediaRoomId) cleanupPeer(socket.data.mediaRoomId);
  });
}
