/**
 * Client-side call recorder — composes the call into a hidden canvas + mixes
 * all audio through WebAudio, then feeds both to MediaRecorder. Everything
 * happens ON THIS DEVICE: zero server CPU, zero storage cost, and the
 * recording downloads as a .webm the moment you stop.
 *
 * Layout: screen-shares get the hero area with camera tiles in a strip below;
 * with no screens it's an auto-sized camera grid. Audio-only participants get
 * an initial-letter tile. Participants can join/leave mid-recording — the
 * compositor re-reads its sources every frame.
 *
 *   const rec = createCallRecorder({ getSources });
 *   rec.start();
 *   const blob = await rec.stop();   // then saveBlob(blob, "call.webm")
 *
 * getSources() → { tiles: [{ id, stream, label }], screens: [{ id, stream, label }] }
 */

const W = 1280;
const H = 720;
const FPS = 30;

function pickMime() {
  const options = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  return options.find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || "";
}

export function createCallRecorder({ getSources }) {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");

  // stream.id → hidden <video> element playing it (for drawImage).
  const videos = new Map();
  // stream.id → true once its audio is wired into the mix.
  const audioWired = new Set();

  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const audioDest = audioCtx.createMediaStreamDestination();

  let raf = null;
  let recorder = null;
  let chunks = [];
  let startedAt = 0;
  let stopped = false;

  function videoFor(stream) {
    let v = videos.get(stream.id);
    if (!v) {
      v = document.createElement("video");
      v.muted = true;
      v.playsInline = true;
      v.autoplay = true;
      v.srcObject = stream;
      v.play().catch(() => {});
      videos.set(stream.id, v);
    }
    return v;
  }

  function wireAudio(stream) {
    if (audioWired.has(stream.id) || stream.getAudioTracks().length === 0) return;
    try {
      audioCtx.createMediaStreamSource(stream).connect(audioDest);
      audioWired.add(stream.id);
    } catch {
      /* stream may be ended — skip */
    }
  }

  // Draw a stream into a rect: cover-fit video, or an initial tile for
  // audio-only participants; name label along the bottom edge.
  function drawTile(t, x, y, w, h) {
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 10);
    ctx.clip();
    ctx.fillStyle = "#111827";
    ctx.fillRect(x, y, w, h);

    const v = t.stream ? videoFor(t.stream) : null;
    const hasFrames = v && v.videoWidth > 0 && t.stream.getVideoTracks().some((tr) => tr.enabled && tr.readyState === "live");
    if (hasFrames) {
      const scale = Math.max(w / v.videoWidth, h / v.videoHeight);
      const dw = v.videoWidth * scale;
      const dh = v.videoHeight * scale;
      ctx.drawImage(v, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
    } else {
      // Audio-only: brand-violet initial circle.
      const r = Math.min(w, h) * 0.22;
      ctx.fillStyle = "#4c1d95";
      ctx.beginPath();
      ctx.arc(x + w / 2, y + h / 2 - 8, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#e9d5ff";
      ctx.font = `bold ${Math.round(r)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText((t.label || "?")[0].toUpperCase(), x + w / 2, y + h / 2 - 8);
    }

    if (t.label) {
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(x, y + h - 26, w, 26);
      ctx.fillStyle = "#f9fafb";
      ctx.font = "600 14px sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(t.label, x + 10, y + h - 13, w - 20);
    }
    ctx.restore();
  }

  function drawGrid(tiles, x, y, w, h) {
    if (tiles.length === 0) return;
    const cols = Math.ceil(Math.sqrt(tiles.length));
    const rows = Math.ceil(tiles.length / cols);
    const gap = 8;
    const tw = (w - gap * (cols - 1)) / cols;
    const th = (h - gap * (rows - 1)) / rows;
    tiles.forEach((t, i) => {
      const cx = x + (i % cols) * (tw + gap);
      const cy = y + Math.floor(i / cols) * (th + gap);
      drawTile(t, cx, cy, tw, th);
    });
  }

  function frame() {
    if (stopped) return;
    const { tiles = [], screens = [] } = getSources() || {};
    for (const s of [...tiles, ...screens]) if (s.stream) wireAudio(s.stream);

    ctx.fillStyle = "#030712";
    ctx.fillRect(0, 0, W, H);

    if (screens.length > 0) {
      // Hero screen-share + camera strip along the bottom.
      drawTile(screens[0], 8, 8, W - 16, H - 176);
      drawGrid(tiles.slice(0, 6), 8, H - 160, W - 16, 152);
    } else {
      drawGrid(tiles, 8, 8, W - 16, H - 16);
    }

    // Discreet watermark + REC dot (blinking) baked into the recording.
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.font = "600 13px sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "top";
    ctx.fillText("recorded with Groot", W - 12, 10);
    if (Math.floor(performance.now() / 600) % 2 === 0) {
      ctx.fillStyle = "#ef4444";
      ctx.beginPath();
      ctx.arc(18, 18, 7, 0, Math.PI * 2);
      ctx.fill();
    }

    raf = requestAnimationFrame(frame);
  }

  return {
    start() {
      audioCtx.resume().catch(() => {});
      const stream = canvas.captureStream(FPS);
      const audioTrack = audioDest.stream.getAudioTracks()[0];
      if (audioTrack) stream.addTrack(audioTrack);
      recorder = new MediaRecorder(stream, { mimeType: pickMime(), videoBitsPerSecond: 2_500_000 });
      chunks = [];
      recorder.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
      recorder.start(1000); // 1s chunks — a crash loses at most a second
      startedAt = Date.now();
      frame();
    },

    elapsedMs() {
      return startedAt ? Date.now() - startedAt : 0;
    },

    stop() {
      return new Promise((resolve) => {
        stopped = true;
        cancelAnimationFrame(raf);
        if (!recorder || recorder.state === "inactive") {
          resolve(new Blob(chunks, { type: "video/webm" }));
        } else {
          recorder.onstop = () => resolve(new Blob(chunks, { type: "video/webm" }));
          recorder.stop();
        }
        // Teardown a tick later so the final chunk flushes first.
        setTimeout(() => {
          for (const v of videos.values()) {
            v.srcObject = null;
          }
          videos.clear();
          audioCtx.close().catch(() => {});
        }, 250);
      });
    },
  };
}

/** Trigger a browser download for a recorded blob. */
export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
