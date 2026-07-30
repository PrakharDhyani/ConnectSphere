/**
 * mediasoup — the WebRTC SFU (Selective Forwarding Unit).
 *
 * What it is: a media server. Each browser sends ONE upstream copy of its
 * camera/mic to us; we forward it to the other people in the room. (A plain
 * peer-to-peer mesh has everyone upload to everyone — it collapses past a few
 * participants. The SFU is what makes group calls scale.)
 *
 * Vocabulary (used across media.handlers.js):
 *   Worker  — a mediasoup C++ subprocess that does the media work. One is
 *             plenty for dev; production runs a pool (≈ 1 per CPU core).
 *   Router  — lives inside a Worker; one per ROOM. It knows the room's codecs
 *             and routes media between that room's participants.
 *   Transport (WebRtcTransport) — one network pipe to a browser. Each peer has
 *             two: a SEND transport (their mic/cam up) and a RECV transport
 *             (everyone else's media down).
 *   Producer — an incoming track from a peer (their audio, or their video).
 *   Consumer — an outgoing track to a peer (someone else's producer).
 */
import * as mediasoup from "mediasoup";
import { logger } from "../utils/logger.js";

let worker;

// The codecs a room's Router will accept. Opus for audio, VP8 for video —
// both are universally supported by browsers and need no licensing.
export const mediaCodecs = [
  { kind: "audio", mimeType: "audio/opus", clockRate: 48000, channels: 2 },
  {
    kind: "video",
    mimeType: "video/VP8",
    clockRate: 90000,
    parameters: { "x-google-start-bitrate": 1000 },
  },
];

export async function createMediasoupWorker() {
  worker = await mediasoup.createWorker({
    // The UDP/TCP port range mediasoup uses for media (RTP). Small range is
    // fine for dev; open these on the firewall/host in production.
    rtcMinPort: Number(process.env.MEDIASOUP_RTC_MIN_PORT) || 40000,
    rtcMaxPort: Number(process.env.MEDIASOUP_RTC_MAX_PORT) || 40100,
    logLevel: "warn",
  });

  // If the media subprocess ever dies, the app can't serve calls — fail loud.
  worker.on("died", () => {
    logger.error("❌ mediasoup worker died — exiting");
    setTimeout(() => process.exit(1), 2000);
  });

  logger.info(`✅ mediasoup worker created (pid ${worker.pid})`);
  return worker;
}

export function getWorker() {
  if (!worker) throw new Error("mediasoup worker not started");
  return worker;
}
