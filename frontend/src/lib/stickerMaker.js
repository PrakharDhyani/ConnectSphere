/**
 * Turn a photo into a sticker, entirely on-device.
 *
 * Pipeline: image → square cover-crop → MediaPipe selfie segmentation →
 * person kept, background cut to transparent → soft edge + white outline
 * (the WhatsApp/Telegram sticker look) → PNG blob.
 *
 * Reuses the SAME `@mediapipe/tasks-vision` ImageSegmenter that lib/bgFilter.js
 * loads for call backgrounds, so the ~1 MB model is usually already warm and
 * costs nothing extra. Everything runs locally — the photo never leaves the
 * browser until the finished sticker is uploaded like any other chat image.
 *
 * Degradation: if the model cannot load (offline), `cutout()` throws and the
 * caller offers to save the plain square crop instead — a sticker with a
 * background is still a usable sticker.
 */

const STICKER_SIZE = 512; // WhatsApp uses 512×512; big enough to look sharp

let segmenterPromise = null;

async function getSegmenter() {
  if (!segmenterPromise) {
    segmenterPromise = (async () => {
      const { ImageSegmenter, FilesetResolver } = await import("@mediapipe/tasks-vision");
      const fileset = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.0/wasm"
      );
      return ImageSegmenter.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath:
            "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite",
          delegate: "GPU",
        },
        // IMAGE, not VIDEO — this is a one-shot still, and the running mode
        // must match or segment() throws.
        runningMode: "IMAGE",
        outputConfidenceMasks: true,
        outputCategoryMask: false,
      });
    })().catch((err) => {
      segmenterPromise = null; // let the next attempt retry
      throw err;
    });
  }
  return segmenterPromise;
}

/** Load a File/Blob into an HTMLImageElement. */
export function loadImage(fileOrUrl) {
  return new Promise((resolve, reject) => {
    const url = typeof fileOrUrl === "string" ? fileOrUrl : URL.createObjectURL(fileOrUrl);
    const img = new Image();
    img.onload = () => {
      if (typeof fileOrUrl !== "string") URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      if (typeof fileOrUrl !== "string") URL.revokeObjectURL(url);
      reject(new Error("Could not read that image"));
    };
    img.src = url;
  });
}

/**
 * Square cover-crop, optionally offset/zoomed by the crop UI.
 * `zoom` 1 = fit the short edge; `offset` is in source pixels.
 */
export function cropSquare(img, { zoom = 1, offsetX = 0, offsetY = 0 } = {}) {
  const canvas = document.createElement("canvas");
  canvas.width = STICKER_SIZE;
  canvas.height = STICKER_SIZE;
  const ctx = canvas.getContext("2d");

  const side = Math.min(img.naturalWidth, img.naturalHeight) / zoom;
  const sx = (img.naturalWidth - side) / 2 + offsetX;
  const sy = (img.naturalHeight - side) / 2 + offsetY;
  // Clamp so dragging can never sample outside the image (which paints black).
  const cx = Math.max(0, Math.min(sx, img.naturalWidth - side));
  const cy = Math.max(0, Math.min(sy, img.naturalHeight - side));

  ctx.drawImage(img, cx, cy, side, side, 0, 0, STICKER_SIZE, STICKER_SIZE);
  return canvas;
}

/**
 * Remove the background from a square canvas. Returns a NEW canvas with
 * transparency, or throws if the model is unavailable.
 */
export async function cutout(squareCanvas) {
  const segmenter = await getSegmenter();
  const result = segmenter.segment(squareCanvas);
  const masks = result?.confidenceMasks;
  if (!masks?.length) {
    result?.close?.();
    throw new Error("Could not find a subject in that photo");
  }

  // Which mask is the person? Ask the model rather than assuming index 0.
  const labels = (segmenter.getLabels?.() || []).map((l) => String(l).toLowerCase());
  let index = labels.findIndex((l) => l && !l.includes("background"));
  let invert = false;
  if (index < 0 || masks.length === 1) {
    index = 0;
    invert = labels[0]?.includes("background") ?? false;
  }

  const mask = masks[Math.min(index, masks.length - 1)];
  const data = mask.getAsFloat32Array();
  const mw = mask.width;
  const mh = mask.height;

  // Mask → alpha canvas (same soft ramp as bgFilter: hard cuts look jagged).
  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = mw;
  maskCanvas.height = mh;
  const maskCtx = maskCanvas.getContext("2d");
  const imageData = maskCtx.createImageData(mw, mh);
  const px = imageData.data;
  for (let i = 0; i < data.length; i++) {
    const p = invert ? 1 - data[i] : data[i];
    px[i * 4 + 3] = p < 0.2 ? 0 : p > 0.8 ? 255 : ((p - 0.2) / 0.6) * 255;
  }
  maskCtx.putImageData(imageData, 0, 0);
  masks.forEach((m) => m.close?.());

  const size = squareCanvas.width;
  const out = document.createElement("canvas");
  out.width = size;
  out.height = size;
  const ctx = out.getContext("2d");

  // person = photo ∩ mask
  ctx.drawImage(squareCanvas, 0, 0);
  ctx.save();
  ctx.globalCompositeOperation = "destination-in";
  ctx.filter = "blur(2px)"; // feather the edge
  ctx.drawImage(maskCanvas, 0, 0, size, size);
  ctx.restore();

  return out;
}

/**
 * The sticker "look": a white outline around the cut-out plus a soft drop
 * shadow, so it reads as a sticker on any chat background rather than a
 * floating photo fragment.
 *
 * Trick: draw the silhouette repeatedly at small offsets in white
 * (`source-in` recolours the alpha), which is a cheap dilation — no
 * per-pixel edge walk needed.
 */
export function addStickerOutline(cutoutCanvas, { thickness = 10 } = {}) {
  const size = cutoutCanvas.width;
  const out = document.createElement("canvas");
  out.width = size;
  out.height = size;
  const ctx = out.getContext("2d");

  // White silhouette of the cut-out.
  const silhouette = document.createElement("canvas");
  silhouette.width = size;
  silhouette.height = size;
  const sctx = silhouette.getContext("2d");
  sctx.drawImage(cutoutCanvas, 0, 0);
  sctx.globalCompositeOperation = "source-in";
  sctx.fillStyle = "#fff";
  sctx.fillRect(0, 0, size, size);

  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = thickness * 1.4;
  ctx.shadowOffsetY = thickness * 0.3;
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 12) {
    ctx.drawImage(silhouette, Math.cos(a) * thickness, Math.sin(a) * thickness);
  }
  ctx.restore();

  ctx.drawImage(cutoutCanvas, 0, 0);
  return out;
}

export const canvasToBlob = (canvas, type = "image/png", quality = 0.92) =>
  new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not encode the sticker"))), type, quality)
  );

/**
 * Full pipeline: File → sticker PNG Blob.
 * `removeBackground: false` keeps the plain square crop (the offline path).
 */
export async function makeSticker(file, { zoom, offsetX, offsetY, removeBackground = true, outline = true } = {}) {
  const img = await loadImage(file);
  const square = cropSquare(img, { zoom, offsetX, offsetY });
  if (!removeBackground) return { blob: await canvasToBlob(square), canvas: square, cutOut: false };

  const cut = await cutout(square);
  const finished = outline ? addStickerOutline(cut) : cut;
  return { blob: await canvasToBlob(finished), canvas: finished, cutOut: true };
}

export { STICKER_SIZE };
