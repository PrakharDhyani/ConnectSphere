/**
 * The browser half of the call — mediasoup-client — now with screen sharing.
 *
 * Producers carry a `source`: "camera" (your mic + webcam) or "screen" (a
 * shared tab/window). Remote tracks are bucketed by `${socketId}:${source}` so
 * a person's camera and their screen render as two separate tiles, and audio
 * rides in the camera bucket so it plays with their face tile.
 *
 * Imperative objects (device, transports, producers, consumers) live in refs;
 * React state holds only what the UI renders (streams).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import * as mediasoupClient from "mediasoup-client";
import { connectSocket, getSocket } from "@/lib/socket.js";

const emitAck = (socket, ev, arg) => new Promise((resolve) => socket.emit(ev, arg, resolve));
const bucketKey = (socketId, source) => `${socketId}:${source === "screen" ? "screen" : "camera"}`;

export function useMediaRoom(roomId) {
  const [inCall, setInCall] = useState(false);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState(null);
  const [localStream, setLocalStream] = useState(null);
  const [screenStream, setScreenStream] = useState(null);
  const [remotes, setRemotes] = useState([]); // [{ key, socketId, userId, source, stream }]
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [sharingScreen, setSharingScreen] = useState(false);

  const device = useRef(null);
  const sendTransport = useRef(null);
  const recvTransport = useRef(null);
  const camProducers = useRef(new Map()); // "audio"|"video" -> Producer
  const screenProducer = useRef(null);
  const consumers = useRef(new Map()); // consumerId -> Consumer
  const consumerBucket = useRef(new Map()); // consumerId -> bucketKey
  const bucketInfo = useRef(new Map()); // bucketKey -> { socketId, userId, source }
  const remoteMap = useRef(new Map()); // bucketKey -> MediaStream
  const localStreamRef = useRef(null);
  const screenStreamRef = useRef(null);
  const listeners = useRef(null);

  const syncRemotes = useCallback(() => {
    setRemotes(
      [...remoteMap.current.entries()].map(([key, stream]) => ({
        key,
        stream,
        ...bucketInfo.current.get(key),
      }))
    );
  }, []);

  const dropBucket = useCallback(
    (key) => {
      const stream = remoteMap.current.get(key);
      if (stream) stream.getTracks().forEach((t) => t.stop());
      remoteMap.current.delete(key);
      bucketInfo.current.delete(key);
      syncRemotes();
    },
    [syncRemotes]
  );

  const consume = useCallback(
    async (socket, { producerId, socketId, userId, source }) => {
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
      const key = bucketKey(socketId, source);
      consumers.current.set(consumer.id, consumer);
      consumerBucket.current.set(consumer.id, key);

      let stream = remoteMap.current.get(key);
      if (!stream) {
        stream = new MediaStream();
        remoteMap.current.set(key, stream);
        bucketInfo.current.set(key, { socketId, userId, source: source === "screen" ? "screen" : "camera" });
      }
      stream.addTrack(consumer.track);
      syncRemotes();

      await emitAck(socket, "media:resume", { roomId, consumerId: consumer.id });
    },
    [roomId, syncRemotes]
  );

  const removeConsumer = useCallback(
    (consumerId) => {
      const consumer = consumers.current.get(consumerId);
      const key = consumerBucket.current.get(consumerId);
      if (consumer) {
        consumer.close();
        consumers.current.delete(consumerId);
      }
      consumerBucket.current.delete(consumerId);
      if (key) {
        const stream = remoteMap.current.get(key);
        if (stream) {
          stream.getTracks().forEach((t) => t.stop());
          if (stream.getTracks().length === 0) dropBucket(key);
          else syncRemotes();
        }
      }
    },
    [dropBucket, syncRemotes]
  );

  const cleanup = useCallback(() => {
    const socket = getSocket();
    if (listeners.current) {
      socket.off("media:newProducer", listeners.current.onNew);
      socket.off("media:peerLeft", listeners.current.onLeft);
      socket.off("media:consumerClosed", listeners.current.onClosed);
      listeners.current = null;
    }
    camProducers.current.forEach((p) => p.close());
    screenProducer.current?.close();
    consumers.current.forEach((c) => c.close());
    sendTransport.current?.close();
    recvTransport.current?.close();
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    remoteMap.current.forEach((s) => s.getTracks().forEach((t) => t.stop()));

    camProducers.current.clear();
    screenProducer.current = null;
    consumers.current.clear();
    consumerBucket.current.clear();
    bucketInfo.current.clear();
    remoteMap.current.clear();
    sendTransport.current = null;
    recvTransport.current = null;
    device.current = null;
    localStreamRef.current = null;
    screenStreamRef.current = null;
    setLocalStream(null);
    setScreenStream(null);
    setRemotes([]);
    setSharingScreen(false);
    setInCall(false);
  }, []);

  const joinCall = useCallback(async () => {
    if (inCall || joining) return;
    setJoining(true);
    setError(null);
    const socket = connectSocket();
    try {
      const caps = await emitAck(socket, "media:getRtpCapabilities", roomId);
      if (caps.error) throw new Error(caps.error);
      device.current = new mediasoupClient.Device();
      await device.current.load({ routerRtpCapabilities: caps.rtpCapabilities });

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      localStreamRef.current = stream;
      setLocalStream(stream);

      // send transport
      const sp = await emitAck(socket, "media:createTransport", { roomId, direction: "send" });
      if (sp.error) throw new Error(sp.error);
      sendTransport.current = device.current.createSendTransport(sp);
      sendTransport.current.on("connect", ({ dtlsParameters }, cb, eb) => {
        emitAck(socket, "media:connectTransport", { roomId, transportId: sendTransport.current.id, dtlsParameters })
          .then((r) => (r.error ? eb(new Error(r.error)) : cb()))
          .catch(eb);
      });
      sendTransport.current.on("produce", ({ kind, rtpParameters, appData }, cb, eb) => {
        emitAck(socket, "media:produce", {
          roomId,
          transportId: sendTransport.current.id,
          kind,
          rtpParameters,
          source: appData?.source || "camera",
        })
          .then((r) => (r.error ? eb(new Error(r.error)) : cb({ id: r.id })))
          .catch(eb);
      });

      const audioTrack = stream.getAudioTracks()[0];
      const videoTrack = stream.getVideoTracks()[0];
      if (audioTrack)
        camProducers.current.set("audio", await sendTransport.current.produce({ track: audioTrack, appData: { source: "camera" } }));
      if (videoTrack)
        camProducers.current.set("video", await sendTransport.current.produce({ track: videoTrack, appData: { source: "camera" } }));

      // recv transport
      const rp = await emitAck(socket, "media:createTransport", { roomId, direction: "recv" });
      if (rp.error) throw new Error(rp.error);
      recvTransport.current = device.current.createRecvTransport(rp);
      recvTransport.current.on("connect", ({ dtlsParameters }, cb, eb) => {
        emitAck(socket, "media:connectTransport", { roomId, transportId: recvTransport.current.id, dtlsParameters })
          .then((r) => (r.error ? eb(new Error(r.error)) : cb()))
          .catch(eb);
      });

      const onNew = (p) => consume(socket, p);
      const onLeft = ({ socketId }) => {
        dropBucket(bucketKey(socketId, "camera"));
        dropBucket(bucketKey(socketId, "screen"));
      };
      const onClosed = ({ consumerId }) => removeConsumer(consumerId);
      socket.on("media:newProducer", onNew);
      socket.on("media:peerLeft", onLeft);
      socket.on("media:consumerClosed", onClosed);
      listeners.current = { onNew, onLeft, onClosed };

      const { producers } = await emitAck(socket, "media:getProducers", roomId);
      for (const p of producers || []) await consume(socket, p);

      setInCall(true);
    } catch (e) {
      setError(e.message || "Could not join the call");
      cleanup();
    } finally {
      setJoining(false);
    }
  }, [roomId, inCall, joining, consume, dropBucket, removeConsumer, cleanup]);

  const leaveCall = useCallback(() => {
    getSocket().emit("media:leave", roomId, () => {});
    cleanup();
  }, [roomId, cleanup]);

  const startScreenShare = useCallback(async () => {
    if (!inCall || sharingScreen || !sendTransport.current) return;
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const track = stream.getVideoTracks()[0];
      screenProducer.current = await sendTransport.current.produce({ track, appData: { source: "screen" } });
      screenStreamRef.current = stream;
      setScreenStream(stream);
      setSharingScreen(true);
      // Native "Stop sharing" button ends the track → tear our producer down too.
      track.onended = () => stopScreenShare();
    } catch {
      // User cancelled the picker, or permission denied — no-op.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inCall, sharingScreen]);

  const stopScreenShare = useCallback(() => {
    if (screenProducer.current) {
      getSocket().emit("media:closeProducer", { roomId, producerId: screenProducer.current.id }, () => {});
      screenProducer.current.close();
      screenProducer.current = null;
    }
    screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    screenStreamRef.current = null;
    setScreenStream(null);
    setSharingScreen(false);
  }, [roomId]);

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

  useEffect(
    () => () => {
      getSocket().emit("media:leave", roomId, () => {});
      cleanup();
    },
    [roomId, cleanup]
  );

  return {
    inCall,
    joining,
    error,
    localStream,
    screenStream,
    remotes,
    micOn,
    camOn,
    sharingScreen,
    joinCall,
    leaveCall,
    startScreenShare,
    stopScreenShare,
    toggleMic,
    toggleCam,
  };
}
