/**
 * Teams/Meet-style background effects, fully client-side.
 *
 * Pipeline: raw camera track → hidden <video> → canvas rAF loop → the track we
 * hand to mediasoup (same canvas→captureStream trick lib/recorder.js uses).
 * Per frame, MediaPipe's selfie ImageSegmenter (WASM/WebGPU, on-device) gives a
 * person-confidence mask; we draw the chosen background (blurred camera frame,
 * a designer gradient, or an uploaded photo), then composite the person on top
 * using the mask as a soft alpha — feathered edges, no green screen.
 *
 * The ~1 MB model + WASM load lazily from CDNs the FIRST time someone picks an
 * effect — join-call latency is untouched. If that fetch fails (offline dev),
 * the pipeline degrades to passing video through unfiltered.
 */

let segmenterPromise = null;

async function getSegmenter() {
  if (!segmenterPromise) {
    segmenterPromise = (async () => {
      const { ImageSegmenter, FilesetResolver } = await import("@mediapipe/tasks-vision");
      // Version pinned to match package.json exactly — wasm and JS API ship as
      // a pair. (Self-hosting means copying ~14 MB into public/ — documented
      // trade-off, same call as faceFilter.js made before it.)
      const fileset = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.0/wasm"
      );
      return ImageSegmenter.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath:
            "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite",
          delegate: "GPU",
        },
        runningMode: "VIDEO",
        outputConfidenceMasks: true,
        outputCategoryMask: false,
      });
    })().catch((err) => {
      segmenterPromise = null; // allow a retry on the next attempt
      throw err;
    });
  }
  return segmenterPromise;
}

// ── virtual backgrounds ────────────────────────────────────────────────────
// Procedural, drawn once per resolution — crisp at any size, zero assets to
// ship. Deliberately abstract (like Teams' designer set) so they read as
// "professional backdrop", not "cheap clipart office".

function paintGradient(ctx, w, h, stops, { vignette = true } = {}) {
  const g = ctx.createLinearGradient(0, 0, w, h);
  for (const [at, color] of stops) g.addColorStop(at, color);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  if (vignette) {
    const v = ctx.createRadialGradient(w / 2, h / 2, h * 0.35, w / 2, h / 2, h);
    v.addColorStop(0, "rgba(0,0,0,0)");
    v.addColorStop(1, "rgba(0,0,0,0.4)");
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, w, h);
  }
}

function glow(ctx, x, y, r, color) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color);
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

const SCENE_PAINTERS = {
  aurora(ctx, w, h) {
    paintGradient(ctx, w, h, [[0, "#0b1023"], [0.55, "#16213e"], [1, "#0f3460"]]);
    glow(ctx, w * 0.25, h * 0.2, h * 0.7, "rgba(139,92,246,0.35)");
    glow(ctx, w * 0.78, h * 0.3, h * 0.6, "rgba(34,211,238,0.28)");
    glow(ctx, w * 0.55, h * 0.85, h * 0.5, "rgba(217,70,239,0.22)");
  },
  sunset(ctx, w, h) {
    paintGradient(ctx, w, h, [[0, "#2d1b4e"], [0.5, "#93326e"], [1, "#f2733f"]]);
    glow(ctx, w * 0.5, h * 0.92, h * 0.75, "rgba(255,200,120,0.4)");
    glow(ctx, w * 0.15, h * 0.15, h * 0.4, "rgba(120,80,220,0.25)");
  },
  forest(ctx, w, h) {
    paintGradient(ctx, w, h, [[0, "#0a1f1a"], [0.6, "#12372e"], [1, "#1d5c43"]]);
    glow(ctx, w * 0.8, h * 0.1, h * 0.55, "rgba(160,255,190,0.16)");
    glow(ctx, w * 0.2, h * 0.75, h * 0.5, "rgba(50,180,120,0.18)");
  },
  slate(ctx, w, h) {
    // Neutral graphite — the "I'm in a meeting with my manager" one.
    paintGradient(ctx, w, h, [[0, "#1a1d24"], [0.5, "#23272f"], [1, "#161920"]]);
    glow(ctx, w * 0.7, h * 0.2, h * 0.8, "rgba(148,163,184,0.10)");
  },
};

export const BG_EFFECTS = [
  { id: "none", label: "None", kind: "none" },
  { id: "blur", label: "Blur", kind: "blur", px: 10 },
  { id: "blur-strong", label: "Strong blur", kind: "blur", px: 22 },
  { id: "aurora", label: "Aurora", kind: "scene" },
  { id: "sunset", label: "Sunset", kind: "scene" },
  { id: "forest", label: "Forest", kind: "scene" },
  { id: "slate", label: "Graphite", kind: "scene" },
  { id: "custom", label: "Your photo", kind: "custom" },
];

const effectById = (id) => BG_EFFECTS.find((e) => e.id === id);

/** Draw an image covering w×h (like CSS object-fit: cover). */
function drawCover(ctx, img, w, h) {
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  if (!iw || !ih) return;
  const scale = Math.max(w / iw, h / ih);
  const dw = iw * scale, dh = ih * scale;
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

/**
 * Wrap a raw camera track in the background-effect pipeline.
 * Returns { track, setEffect, stop } — `track` is live immediately (drawing
 * plain video) and the effect kicks in once the model finishes loading.
 * setEffect(id, image?) — pass an HTMLImageElement/ImageBitmap for "custom".
 */
export function createBackgroundPipeline(rawTrack) {
  const settings = rawTrack.getSettings?.() || {};
  const width = settings.width || 640;
  const height = settings.height || 480;

  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.srcObject = new MediaStream([rawTrack]);
  video.play().catch(() => {});

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");

  // Offscreen layers: person cut-out, soft alpha mask, pre-painted scene.
  const personCanvas = document.createElement("canvas");
  personCanvas.width = width;
  personCanvas.height = height;
  const personCtx = personCanvas.getContext("2d");

  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = width;
  maskCanvas.height = height;
  const maskCtx = maskCanvas.getContext("2d");
  let maskImage = null; // ImageData reused across frames

  const sceneCanvas = document.createElement("canvas");
  sceneCanvas.width = width;
  sceneCanvas.height = height;
  const sceneCtx = sceneCanvas.getContext("2d");

  let effect = effectById("none");
  let customImage = null;
  let segmenter = null;
  let personMaskIndex = -1; // resolved from model labels on first load
  let invertMask = false;
  let loadFailed = false;
  let raf = 0;
  let stopped = false;
  let lastVideoTime = -1;

  function ensureSegmenter() {
    if (segmenter || loadFailed) return;
    getSegmenter()
      .then((s) => {
        // Model labels tell us which confidence mask is the person. The selfie
        // model reports [background, person]-style labels; if only one mask
        // comes back and it's labelled background, we invert it instead.
        const labels = (s.getLabels?.() || []).map((l) => String(l).toLowerCase());
        const fg = labels.findIndex((l) => !l.includes("background"));
        if (labels.length > 1 && fg >= 0) {
          personMaskIndex = fg;
        } else {
          personMaskIndex = 0;
          invertMask = labels[0]?.includes("background") ?? false;
        }
        segmenter = s;
      })
      .catch(() => { loadFailed = true; }); // degrade to passthrough
  }

  /** Person-confidence mask → soft alpha on maskCanvas. */
  function updateMask(result) {
    const masks = result?.confidenceMasks;
    if (!masks?.length) return false;
    const mask = masks[Math.min(personMaskIndex, masks.length - 1)];
    const data = mask.getAsFloat32Array();
    const mw = mask.width, mh = mask.height;
    if (!maskImage || maskImage.width !== mw || maskImage.height !== mh) {
      maskCanvas.width = mw;
      maskCanvas.height = mh;
      maskImage = maskCtx.createImageData(mw, mh);
      // alpha does all the work — RGB can stay 0
    }
    const px = maskImage.data;
    for (let i = 0; i < data.length; i++) {
      const p = invertMask ? 1 - data[i] : data[i];
      px[i * 4 + 3] = p < 0.15 ? 0 : p > 0.85 ? 255 : ((p - 0.15) / 0.7) * 255;
    }
    maskCtx.putImageData(maskImage, 0, 0);
    masks.forEach((m) => m.close?.());
    return true;
  }

  function drawBackground() {
    if (effect.kind === "blur") {
      ctx.save();
      ctx.filter = `blur(${effect.px}px)`;
      // Slight over-scale hides the transparent fringe blur() leaves at edges.
      const pad = effect.px * 2;
      ctx.drawImage(video, -pad, -pad, width + pad * 2, height + pad * 2);
      ctx.restore();
    } else if (effect.kind === "custom" && customImage) {
      drawCover(ctx, customImage, width, height);
    } else {
      ctx.drawImage(sceneCanvas, 0, 0, width, height);
    }
  }

  function frame(now) {
    if (stopped) return;
    if (video.readyState >= 2) {
      if (effect.kind === "none" || !segmenter || loadFailed || (effect.kind === "custom" && !customImage)) {
        ctx.drawImage(video, 0, 0, width, height);
      } else {
        let hasMask = false;
        if (video.currentTime !== lastVideoTime) {
          lastVideoTime = video.currentTime;
          try { hasMask = updateMask(segmenter.segmentForVideo(video, now)); } catch { hasMask = false; }
        } else {
          hasMask = maskImage != null;
        }
        if (!hasMask) {
          ctx.drawImage(video, 0, 0, width, height);
        } else {
          // person = video ∩ mask (soft edges via 1px mask blur)
          personCtx.clearRect(0, 0, width, height);
          personCtx.drawImage(video, 0, 0, width, height);
          personCtx.save();
          personCtx.globalCompositeOperation = "destination-in";
          personCtx.filter = "blur(1.5px)";
          personCtx.drawImage(maskCanvas, 0, 0, width, height);
          personCtx.restore();

          drawBackground();
          ctx.drawImage(personCanvas, 0, 0, width, height);
        }
      }
    }
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  const outTrack = canvas.captureStream(30).getVideoTracks()[0];

  return {
    track: outTrack,
    setEffect(id, image) {
      const next = effectById(id) || effectById("none");
      effect = next;
      if (next.kind === "custom" && image) customImage = image;
      if (next.kind === "scene") SCENE_PAINTERS[next.id]?.(sceneCtx, width, height);
      if (next.kind !== "none") ensureSegmenter();
    },
    stop() {
      stopped = true;
      cancelAnimationFrame(raf);
      outTrack.stop();
      video.srcObject = null;
      // NOTE: never stop rawTrack here — useMediaRoom owns the camera.
    },
  };
}
