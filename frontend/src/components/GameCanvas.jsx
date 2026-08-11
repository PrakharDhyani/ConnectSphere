/**
 * The shared drawing surface for the game.
 *
 * Responsive by design: the canvas has a FIXED internal buffer (1000×600) but
 * is scaled to 100% width via CSS, and every stroke is sent in NORMALIZED
 * coordinates (0..1), so it looks identical on a phone and a laptop. Pointer
 * events cover mouse, touch, and stylus; `touch-none` stops the page scrolling
 * while you draw.
 *
 * Only the drawer's pointer draws + broadcasts; everyone renders incoming
 * draw segments and clears on clear.
 *
 * TRANSPORT COMES IN AS PROPS, NOT FROM A SOCKET. Since the Phase 2 migration
 * the wire is the activity SDK, and this component takes the four senders it
 * needs (`draw`/`clear`/`onDraw`/`onClear`) from `useSkribbl`. That keeps the
 * plugin's whole socket surface in one file — and means this component would
 * work unchanged over any transport, which is what made the migration a
 * two-file change instead of a hunt through the canvas code.
 */
import { useEffect, useRef, useState } from "react";
import Button from "@/components/ui/Button.jsx";

const W = 1000;
const H = 600;
const PALETTE = [
  "#111827", "#6b7280", "#e03131", "#f76707", "#f08c00", "#f59f00",
  "#2f9e44", "#099268", "#1971c2", "#1098ad", "#ae3ec9", "#d6336c",
  "#a0522d", "#ffffff",
];

export default function GameCanvas({ isDrawer, draw, clear: sendClear, onDraw, onClear }) {
  const canvasRef = useRef(null);
  const ctxRef = useRef(null);
  const drawing = useRef(false);
  const last = useRef(null);
  const [color, setColor] = useState("#111827");
  const [size, setSize] = useState(5);

  useEffect(() => {
    const ctx = canvasRef.current.getContext("2d");
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctxRef.current = ctx;

    const seg = (s) => {
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.size;
      ctx.beginPath();
      ctx.moveTo(s.x0 * W, s.y0 * H);
      ctx.lineTo(s.x1 * W, s.y1 * H);
      ctx.stroke();
    };
    // The SDK's `on` returns its own unsubscribe, so there is no off() pairing
    // to get wrong. Both are optional: the sdk is null for the first render,
    // before useActivitySdk has built it.
    const offDraw = onDraw?.(({ stroke }) => seg(stroke));
    const offClear = onClear?.(() => ctx.clearRect(0, 0, W, H));
    return () => {
      offDraw?.();
      offClear?.();
    };
  }, [onDraw, onClear]);

  const drawSeg = (s) => {
    const ctx = ctxRef.current;
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.size;
    ctx.beginPath();
    ctx.moveTo(s.x0 * W, s.y0 * H);
    ctx.lineTo(s.x1 * W, s.y1 * H);
    ctx.stroke();
  };

  const norm = (e) => {
    const r = canvasRef.current.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };

  const onDown = (e) => {
    if (!isDrawer) return;
    drawing.current = true;
    last.current = norm(e);
    canvasRef.current.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e) => {
    if (!isDrawer || !drawing.current) return;
    const p = norm(e);
    const stroke = { x0: last.current.x, y0: last.current.y, x1: p.x, y1: p.y, color, size };
    drawSeg(stroke);
    draw?.(stroke);
    last.current = p;
  };
  const onUp = () => {
    drawing.current = false;
    last.current = null;
  };

  const clear = () => {
    ctxRef.current.clearRect(0, 0, W, H);
    sendClear?.();
  };

  return (
    <div>
      <canvas
        ref={canvasRef}
        width={W}
        height={H}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerLeave={onUp}
        style={{ aspectRatio: `${W} / ${H}`, boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.08)" }}
        className={`w-full bg-white rounded-xl touch-none shadow-lg ${isDrawer ? "cursor-crosshair" : "cursor-default"}`}
      />
      {isDrawer && (
        <div className="flex items-center gap-3 mt-3 flex-wrap bg-gray-900/60 border border-gray-800 rounded-xl p-2.5">
          {/* live brush preview */}
          <div className="w-9 h-9 rounded-lg bg-white flex items-center justify-center shrink-0 shadow-inner">
            <span
              className="rounded-full border border-black/10"
              style={{ width: size, height: size, background: color === "#ffffff" ? "#e5e7eb" : color }}
            />
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            {PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                style={{ background: c }}
                className={`w-6 h-6 rounded-full border transition-transform hover:scale-110
                  ${color === c ? "ring-2 ring-brand-400 ring-offset-1 ring-offset-gray-900 scale-110" : "border-gray-600"}`}
                title={c === "#ffffff" ? "Eraser" : c}
              />
            ))}
          </div>

          <div className="flex items-center gap-2">
            <input
              type="range"
              min="2"
              max="28"
              value={size}
              onChange={(e) => setSize(Number(e.target.value))}
              className="accent-brand-500 w-24"
              title={`Brush size: ${size}px`}
            />
            <Button variant="secondary" onClick={clear}>Clear</Button>
          </div>
        </div>
      )}
    </div>
  );
}
