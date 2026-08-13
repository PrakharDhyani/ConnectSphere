/**
 * Voice notes — record from the mic, show a live waveform, send as an audio
 * attachment.
 *
 * Uses MediaRecorder (same API lib/recorder.js already uses for calls) plus a
 * WebAudio AnalyserNode for the level meter. The recorded blob goes through
 * the ordinary chat-attachment upload, so voice notes need no new backend:
 * they are just `kind: "audio"` files.
 *
 * The peak array captured here is sent along as `waveform` so the bubble can
 * draw the real shape of the audio instead of a decorative squiggle — and the
 * receiver gets it without downloading and decoding the whole file first.
 */
import { useCallback, useEffect, useRef, useState } from "react";

const MAX_SECONDS = 300; // 5 minutes — a voice note, not a podcast
const WAVEFORM_BARS = 48;

/** Pick a container/codec this browser can actually produce. */
function pickMimeType() {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4", // Safari
  ];
  return candidates.find((t) => window.MediaRecorder?.isTypeSupported?.(t)) || "";
}

export function useVoiceRecorder() {
  const [recording, setRecording] = useState(false);
  const [paused, setPaused] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0); // 0..1, for the live meter
  const [error, setError] = useState(null);

  const streamRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const rafRef = useRef(0);
  const peaksRef = useRef([]);
  const startedAtRef = useRef(0);
  const pausedMsRef = useRef(0);
  const pauseStartRef = useRef(0);
  const tickRef = useRef(0);
  // The stop() promise resolves from the recorder's onstop handler.
  const resolveStopRef = useRef(null);

  const cleanup = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    clearInterval(tickRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    analyserRef.current = null;
    // close() is async and can reject if already closed — best effort.
    audioCtxRef.current?.close?.().catch(() => {});
    audioCtxRef.current = null;
    recorderRef.current = null;
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const start = useCallback(async () => {
    if (recording) return false;
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;

      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = recorder;
      chunksRef.current = [];
      peaksRef.current = [];

      recorder.ondataavailable = (e) => e.data.size > 0 && chunksRef.current.push(e.data);
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        const durationMs = Date.now() - startedAtRef.current - pausedMsRef.current;
        resolveStopRef.current?.({
          blob,
          durationMs: Math.max(0, durationMs),
          waveform: downsamplePeaks(peaksRef.current, WAVEFORM_BARS),
          mimeType: recorder.mimeType || "audio/webm",
        });
        resolveStopRef.current = null;
        cleanup();
      };

      // Level meter
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioCtx();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      analyserRef.current = analyser;

      const buf = new Uint8Array(analyser.frequencyBinCount);
      const sample = () => {
        if (!analyserRef.current) return;
        analyser.getByteTimeDomainData(buf);
        // RMS around the 128 midpoint → 0..1
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / buf.length);
        const scaled = Math.min(1, rms * 2.2); // voices rarely hit full scale
        setLevel(scaled);
        peaksRef.current.push(scaled);
        rafRef.current = requestAnimationFrame(sample);
      };

      recorder.start(250); // timeslice → a crash loses at most 250ms
      startedAtRef.current = Date.now();
      pausedMsRef.current = 0;
      setSeconds(0);
      setPaused(false);
      setRecording(true);
      rafRef.current = requestAnimationFrame(sample);

      tickRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startedAtRef.current - pausedMsRef.current) / 1000);
        setSeconds(elapsed);
        if (elapsed >= MAX_SECONDS) recorderRef.current?.stop();
      }, 200);

      return true;
    } catch (err) {
      setError(
        err?.name === "NotAllowedError"
          ? "Microphone permission denied"
          : "Could not start recording"
      );
      cleanup();
      return false;
    }
  }, [recording, cleanup]);

  /** Stop and resolve with the recorded note. */
  const stop = useCallback(() => {
    if (!recorderRef.current || recorderRef.current.state === "inactive") return Promise.resolve(null);
    const p = new Promise((resolve) => { resolveStopRef.current = resolve; });
    recorderRef.current.stop();
    setRecording(false);
    setPaused(false);
    setLevel(0);
    return p;
  }, []);

  /** Throw the recording away without producing a blob. */
  const cancel = useCallback(() => {
    resolveStopRef.current = null;
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.onstop = null;
      recorderRef.current.stop();
    }
    chunksRef.current = [];
    peaksRef.current = [];
    setRecording(false);
    setPaused(false);
    setSeconds(0);
    setLevel(0);
    cleanup();
  }, [cleanup]);

  const togglePause = useCallback(() => {
    const rec = recorderRef.current;
    if (!rec || rec.state === "inactive") return;
    if (rec.state === "recording") {
      rec.pause();
      pauseStartRef.current = Date.now();
      setPaused(true);
    } else {
      rec.resume();
      pausedMsRef.current += Date.now() - pauseStartRef.current;
      setPaused(false);
    }
  }, []);

  return { recording, paused, seconds, level, error, start, stop, cancel, togglePause, maxSeconds: MAX_SECONDS };
}

/** Average an arbitrary-length peak list down to N bars (0..100 ints). */
export function downsamplePeaks(peaks, bars) {
  if (!peaks.length) return [];
  const out = [];
  const per = peaks.length / bars;
  for (let i = 0; i < bars; i++) {
    const slice = peaks.slice(Math.floor(i * per), Math.max(Math.floor((i + 1) * per), Math.floor(i * per) + 1));
    const avg = slice.reduce((a, b) => a + b, 0) / (slice.length || 1);
    // Store as small ints — this rides along in the message document.
    out.push(Math.round(Math.min(1, avg) * 100));
  }
  return out;
}

export const fmtDuration = (ms) => {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};
