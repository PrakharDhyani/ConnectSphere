/**
 * The browser half of the video call — mediasoup-client.
 *
 * The flow when you "Join call":
 *   1. ask the server for the room's RTP capabilities, load a Device with them
 *   2. getUserMedia (camera + mic)
 *   3. create a SEND transport, then produce() the mic + camera tracks up
 *   4. create a RECV transport
 *   5. consume() every producer already in the room, and subscribe to
 *      media:newProducer so people who join later appear automatically
 *
 * Long-lived objects (device, transports, producers, consumers) live in refs —
 * they're imperative and must survive re-renders. React state holds only what
 * the UI renders: the local stream and the list of remote peer streams.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import * as mediasoupClient from "mediasoup-client";
import { connectSocket, getSocket } from "@/lib/socket.js";

const emitAck = (socket, ev, arg) => new Promise((resolve) => socket.emit(ev, arg, resolve));

export function useMediaRoom(roomId) {
  const [inCall, setInCall] = useState(false);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState(null);
  const [localStream, setLocalStream] = useState(null);
  const [peers, setPeers] = useState([]); // [{ socketId, userId, stream }]
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);

  const device = useRef(null);
  const sendTransport = useRef(null);
  const recvTransport = useRef(null);
  const producers = useRef(new Map()); // "audio"|"video" -> Producer
  const consumers = useRef(new Map()); // consumerId -> Consumer
  const peerMap = useRef(new Map()); // socketId -> { userId, stream }
  const localStreamRef = useRef(null);
  const listeners = useRef(null);

  const syncPeers = useCallback(() => {
    setPeers(
      [...peerMap.current.entries()].map(([socketId, e]) => ({
        socketId,
        userId: e.userId,
        stream: e.stream,
      }))
    );
  }, []);

  const addTrack = useCallback(
    (socketId, userId, track) => {
      let entry = peerMap.current.get(socketId);
      if (!entry) {
        entry = { userId, stream: new MediaStream() };
        peerMap.current.set(socketId, entry);
      }
      entry.stream.addTrack(track);
      syncPeers();
    },
    [syncPeers]
  );

  const dropPeer = useCallback(
    (socketId) => {
      const entry = peerMap.current.get(socketId);
      if (entry) entry.stream.getTracks().forEach((t) => t.stop());
      peerMap.current.delete(socketId);
      syncPeers();
    },
    [syncPeers]
  );

  const consume = useCallback(
    async (socket, producerId, socketId, userId) => {
      if (!recvTransport.current || !device.current) return;
      const params = await emitAck(socket, "media:consume", {
        roomId,
        transportId: recvTransport.current.id,
        producerId,
        rtpCapabilities: device.current.rtpCapabilities,
      });
      if (params.error) return;

      const consumer = await recvTransport.current.consume({
        id: params.id,
        producerId: params.producerId,
        kind: params.kind,
        rtpParameters: params.rtpParameters,
      });
      consumers.current.set(consumer.id, consumer);
      addTrack(socketId, userId, consumer.track);
      await emitAck(socket, "media:resume", { roomId, consumerId: consumer.id });
    },
    [roomId, addTrack]
  );

  const cleanup = useCallback(() => {
    const socket = getSocket();
    if (listeners.current) {
      socket.off("media:newProducer", listeners.current.onNew);
      socket.off("media:peerLeft", listeners.current.onLeft);
      socket.off("media:consumerClosed", listeners.current.onClosed);
      listeners.current = null;
    }
    producers.current.forEach((p) => p.close());
    consumers.current.forEach((c) => c.close());
    sendTransport.current?.close();
    recvTransport.current?.close();
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    peerMap.current.forEach((e) => e.stream.getTracks().forEach((t) => t.stop()));

    producers.current.clear();
    consumers.current.clear();
    peerMap.current.clear();
    sendTransport.current = null;
    recvTransport.current = null;
    device.current = null;
    localStreamRef.current = null;
    setLocalStream(null);
    setPeers([]);
    setInCall(false);
  }, []);

  const joinCall = useCallback(async () => {
    if (inCall || joining) return;
    setJoining(true);
    setError(null);
    const socket = connectSocket();
    try {
      // 1. capabilities → device
      const caps = await emitAck(socket, "media:getRtpCapabilities", roomId);
      if (caps.error) throw new Error(caps.error);
      device.current = new mediasoupClient.Device();
      await device.current.load({ routerRtpCapabilities: caps.rtpCapabilities });

      // 2. camera + mic
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      localStreamRef.current = stream;
      setLocalStream(stream);

      // 3. send transport + produce
      const sp = await emitAck(socket, "media:createTransport", { roomId, direction: "send" });
      if (sp.error) throw new Error(sp.error);
      sendTransport.current = device.current.createSendTransport(sp);
      sendTransport.current.on("connect", ({ dtlsParameters }, cb, eb) => {
        emitAck(socket, "media:connectTransport", { roomId, transportId: sendTransport.current.id, dtlsParameters })
          .then((r) => (r.error ? eb(new Error(r.error)) : cb()))
          .catch(eb);
      });
      sendTransport.current.on("produce", ({ kind, rtpParameters }, cb, eb) => {
        emitAck(socket, "media:produce", { roomId, transportId: sendTransport.current.id, kind, rtpParameters })
          .then((r) => (r.error ? eb(new Error(r.error)) : cb({ id: r.id })))
          .catch(eb);
      });
      const audioTrack = stream.getAudioTracks()[0];
      const videoTrack = stream.getVideoTracks()[0];
      if (audioTrack) producers.current.set("audio", await sendTransport.current.produce({ track: audioTrack }));
      if (videoTrack) producers.current.set("video", await sendTransport.current.produce({ track: videoTrack }));

      // 4. recv transport
      const rp = await emitAck(socket, "media:createTransport", { roomId, direction: "recv" });
      if (rp.error) throw new Error(rp.error);
      recvTransport.current = device.current.createRecvTransport(rp);
      recvTransport.current.on("connect", ({ dtlsParameters }, cb, eb) => {
        emitAck(socket, "media:connectTransport", { roomId, transportId: recvTransport.current.id, dtlsParameters })
          .then((r) => (r.error ? eb(new Error(r.error)) : cb()))
          .catch(eb);
      });

      // 5. subscribe to future producers / departures, then consume current ones
      const onNew = ({ producerId, socketId, userId }) => consume(socket, producerId, socketId, userId);
      const onLeft = ({ socketId }) => dropPeer(socketId);
      const onClosed = ({ consumerId }) => {
        consumers.current.get(consumerId)?.close();
        consumers.current.delete(consumerId);
      };
      socket.on("media:newProducer", onNew);
      socket.on("media:peerLeft", onLeft);
      socket.on("media:consumerClosed", onClosed);
      listeners.current = { onNew, onLeft, onClosed };

      const { producers: existing } = await emitAck(socket, "media:getProducers", roomId);
      for (const p of existing || []) await consume(socket, p.producerId, p.socketId, p.userId);

      setInCall(true);
    } catch (e) {
      setError(e.message || "Could not join the call");
      cleanup();
    } finally {
      setJoining(false);
    }
  }, [roomId, inCall, joining, consume, dropPeer, cleanup]);

  const leaveCall = useCallback(() => {
    getSocket().emit("media:leave", roomId, () => {});
    cleanup();
  }, [roomId, cleanup]);

  const toggleMic = useCallback(() => {
    const track = localStreamRef.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setMicOn(track.enabled);
  }, []);

  const toggleCam = useCallback(() => {
    const track = localStreamRef.current?.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setCamOn(track.enabled);
  }, []);

  // Leave the call + free everything if the user navigates away mid-call.
  // (media:leave is a no-op server-side when we weren't in a call.)
  useEffect(
    () => () => {
      getSocket().emit("media:leave", roomId, () => {});
      cleanup();
    },
    [roomId, cleanup]
  );

  return { inCall, joining, error, localStream, peers, micOn, camOn, joinCall, leaveCall, toggleMic, toggleCam };
}
