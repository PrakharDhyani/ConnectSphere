import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api.js";
import { makeSticker, loadImage, cropSquare, canvasToBlob } from "@/lib/stickerMaker.js";
import { addCustomSticker } from "@/lib/stickerStore.js";

/**
 * 🪄 Make a sticker from a photo — WhatsApp-style.
 *
 * Pick a photo → drag/zoom to frame it → the background is removed on-device
 * (MediaPipe, the same segmenter the call backgrounds use) → save to your
 * sticker tray. The photo never leaves the browser; only the finished PNG is
 * uploaded, through the ordinary chat-attachment endpoint.
 */
export default function StickerCreator({ roomId, onClose, onCreated }) {
  const [file, setFile] = useState(null);
  const [img, setImg] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [cutBackground, setCutBackground] = useState(true);
  const [outline, setOutline] = useState(true);
  const [preview, setPreview] = useState(null);   // object URL of the result
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [stage, setStage] = useState("pick");     // pick | frame | done

  const fileRef = useRef(null);
  const previewCanvasRef = useRef(null);
  const dragRef = useRef(null);
  const resultBlobRef = useRef(null);
  const previewUrlRef = useRef(null);

  useEffect(() => () => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
  }, []);

  // Live framing preview (before background removal) — cheap, redraws on drag.
  useEffect(() => {
    if (!img || stage !== "frame") return;
    const canvas = previewCanvasRef.current;
    if (!canvas) return;
    const square = cropSquare(img, { zoom, offsetX: offset.x, offsetY: offset.y });
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(square, 0, 0, canvas.width, canvas.height);
  }, [img, zoom, offset, stage]);

  async function pickFile(e) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (!f.type.startsWith("image/")) return setError("Pick an image file");
    setError(null);
    try {
      const loaded = await loadImage(f);
      setFile(f);
      setImg(loaded);
      setZoom(1);
      setOffset({ x: 0, y: 0 });
      setStage("frame");
    } catch {
      setError("Could not read that image");
    }
  }

  /**
   * Drag to reposition the crop. Pointer movement is in CSS pixels but the
   * offset is in SOURCE pixels, so it is scaled by (crop side / preview width)
   * — otherwise dragging feels wrong on a large photo shown in a small box.
   * Moving the pointer right should reveal what is to the right, hence the
   * negative sign.
   */
  function onPointerDown(e) {
    if (!img) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const rect = e.currentTarget.getBoundingClientRect();
    const side = Math.min(img.naturalWidth, img.naturalHeight) / zoom;
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      baseX: offset.x,
      baseY: offset.y,
      scale: side / rect.width,
    };
  }

  function onPointerMove(e) {
    const d = dragRef.current;
    if (!d) return;
    setOffset({
      x: d.baseX - (e.clientX - d.startX) * d.scale,
      y: d.baseY - (e.clientY - d.startY) * d.scale,
    });
  }

  function onPointerUp(e) {
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    dragRef.current = null;
  }

  async function build() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const { blob, cutOut } = await makeSticker(file, {
        zoom,
        offsetX: offset.x,
        offsetY: offset.y,
        removeBackground: cutBackground,
        outline: outline && cutBackground,
      });
      resultBlobRef.current = blob;
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = URL.createObjectURL(blob);
      setPreview(previewUrlRef.current);
      setStage("done");
      if (cutBackground && !cutOut) setError("Background removal unavailable — saved as-is");
    } catch (err) {
      // Offline / model failed → offer the plain crop rather than nothing.
      try {
        const square = cropSquare(img, { zoom, offsetX: offset.x, offsetY: offset.y });
        const blob = await canvasToBlob(square);
        resultBlobRef.current = blob;
        if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = URL.createObjectURL(blob);
        setPreview(previewUrlRef.current);
        setStage("done");
        setError(err.message || "Could not remove the background — kept the original");
      } catch {
        setError("Could not build that sticker");
      }
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!resultBlobRef.current) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("files", resultBlobRef.current, "sticker.png");
      const res = await api.post(`/rooms/${roomId}/attachments`, form);
      const uploaded = res.data.data.attachments?.[0];
      if (!uploaded?.url) throw new Error("Upload failed");
      addCustomSticker({ url: uploaded.url, name: "My sticker" });
      onCreated?.(uploaded);
      onClose?.();
    } catch (err) {
      setError(
        err.response?.status === 501
          ? "File storage isn't configured on this server"
          : err.response?.data?.error?.message || "Could not save the sticker"
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[120] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
         onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl border border-gray-700 bg-gray-900 shadow-2xl overflow-hidden"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
          <h3 className="text-sm font-semibold text-white">🪄 Make a sticker</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-200 text-sm">✕</button>
        </div>

        <div className="p-4 space-y-3">
          {stage === "pick" && (
            <button
              onClick={() => fileRef.current?.click()}
              className="w-full h-40 rounded-xl border-2 border-dashed border-gray-700 hover:border-brand-500 text-gray-400 hover:text-brand-300 transition-colors flex flex-col items-center justify-center gap-2"
            >
              <span className="text-3xl">🖼️</span>
              <span className="text-sm font-medium">Choose a photo</span>
              <span className="text-[11px] text-gray-600">The background is removed on your device</span>
            </button>
          )}

          {stage === "frame" && (
            <>
              <div
                className="relative mx-auto w-56 h-56 rounded-xl overflow-hidden bg-[conic-gradient(#1f2937_25%,#111827_0_50%,#1f2937_0_75%,#111827_0)] bg-[length:16px_16px] cursor-move touch-none"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
              >
                <canvas ref={previewCanvasRef} width={224} height={224} className="w-full h-full" />
                <div className="absolute inset-0 ring-1 ring-white/10 rounded-xl pointer-events-none" />
              </div>

              <label className="block">
                <span className="text-[11px] text-gray-400">Zoom</span>
                <input
                  type="range" min="1" max="3" step="0.05" value={zoom}
                  onChange={(e) => setZoom(Number(e.target.value))}
                  className="w-full accent-brand-500"
                />
              </label>

              <div className="flex flex-col gap-1.5">
                <label className="flex items-center gap-2 text-xs text-gray-300">
                  <input type="checkbox" checked={cutBackground} onChange={(e) => setCutBackground(e.target.checked)} className="accent-brand-500" />
                  Remove background
                </label>
                <label className="flex items-center gap-2 text-xs text-gray-300">
                  <input type="checkbox" checked={outline} disabled={!cutBackground} onChange={(e) => setOutline(e.target.checked)} className="accent-brand-500" />
                  White outline
                </label>
              </div>

              <div className="flex gap-2">
                <button onClick={() => setStage("pick")} className="flex-1 py-2 rounded-lg text-sm border border-gray-700 text-gray-300 hover:border-gray-500">Back</button>
                <button onClick={build} disabled={busy}
                        className="flex-1 py-2 rounded-lg text-sm font-medium bg-gradient-to-r from-brand-600 to-fuchsia-600 text-white disabled:opacity-50">
                  {busy ? "Working…" : "Preview"}
                </button>
              </div>
            </>
          )}

          {stage === "done" && preview && (
            <>
              <div className="mx-auto w-56 h-56 rounded-xl bg-[conic-gradient(#1f2937_25%,#111827_0_50%,#1f2937_0_75%,#111827_0)] bg-[length:16px_16px] flex items-center justify-center">
                <img src={preview} alt="sticker preview" className="max-w-full max-h-full" />
              </div>
              <div className="flex gap-2">
                <button onClick={() => setStage("frame")} className="flex-1 py-2 rounded-lg text-sm border border-gray-700 text-gray-300 hover:border-gray-500">Adjust</button>
                <button onClick={save} disabled={busy}
                        className="flex-1 py-2 rounded-lg text-sm font-medium bg-gradient-to-r from-brand-600 to-fuchsia-600 text-white disabled:opacity-50">
                  {busy ? "Saving…" : "Save sticker"}
                </button>
              </div>
            </>
          )}

          {error && <p className="text-xs text-amber-300">⚠️ {error}</p>}
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={pickFile} />
        </div>
      </div>
    </div>
  );
}
