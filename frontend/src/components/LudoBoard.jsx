import { cellInfo, coord, COLOR_HEX, COLOR_SOFT, COLORS } from "@/games/ludoBoard.js";

const N = 15;
const cells = [];
for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) cells.push([r, c]);

// A slightly darker shade of a hex color, for gradients/borders.
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, ((n >> 16) & 255) + amt));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt));
  const b = Math.max(0, Math.min(255, (n & 255) + amt));
  return `rgb(${r},${g},${b})`;
}

function cellStyle(r, c) {
  const info = cellInfo(r, c);
  switch (info.type) {
    case "base":
      return { background: `linear-gradient(135deg, ${COLOR_SOFT[info.color]}, ${shade(COLOR_HEX[info.color], -30)})` };
    case "home":
      return { background: `linear-gradient(135deg, ${shade(COLOR_HEX[info.color], 25)}, ${COLOR_HEX[info.color]})` };
    case "start":
      return { background: `radial-gradient(circle, ${shade(COLOR_HEX[info.color], 40)}, ${COLOR_HEX[info.color]})` };
    case "center":
      return { background: "radial-gradient(circle, #334155, #0f172a)" };
    case "track":
      return { background: "linear-gradient(180deg, #ffffff, #e9eef5)" };
    default:
      return { background: "transparent" };
  }
}

export default function LudoBoard({ state, myColor, isMyTurn, onMove }) {
  if (!state) return null;
  const seated = COLORS.filter((c) => state.seats?.[c]);
  const movable = new Set(isMyTurn ? state.movable || [] : []);

  return (
    <div
      className="relative w-full max-w-[min(92vw,560px)] mx-auto aspect-square rounded-2xl overflow-hidden select-none shadow-2xl"
      style={{ padding: 6, background: "linear-gradient(135deg, #1e293b, #0f172a)" }}
    >
      <div className="relative w-full h-full rounded-xl overflow-hidden ring-1 ring-white/10">
        {/* board cells */}
        <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${N},1fr)`, gridTemplateRows: `repeat(${N},1fr)` }}>
          {cells.map(([r, c]) => {
            const info = cellInfo(r, c);
            return (
              <div key={`${r},${c}`} style={cellStyle(r, c)} className="border border-black/5 flex items-center justify-center">
                {info.type === "track" && info.safe && <span className="text-[10px] text-amber-500 drop-shadow">★</span>}
                {info.type === "start" && <span className="text-[10px] text-white/90">➤</span>}
                {r === 7 && c === 7 && <span className="text-lg drop-shadow-[0_0_6px_rgba(255,255,255,0.5)]">🏆</span>}
              </div>
            );
          })}
        </div>

        {/* tokens — SVG pawns (glossy head, tapered body, base + ground shadow)
            instead of flat circles, so the pieces read like real board pieces. */}
        {seated.map((color) =>
          (state.tokens[color] || []).map((step, i) => {
            const [r, c] = coord(color, step, i);
            const clickable = color === myColor && movable.has(i);
            const dx = (i % 2) * 6 - 3;
            const dy = Math.floor(i / 2) * 6 - 3;
            const hex = COLOR_HEX[color];
            const gradId = `pawn-${color}-${i}`;
            return (
              <button
                key={`${color}-${i}`}
                type="button"
                disabled={!clickable}
                onClick={() => clickable && onMove(i)}
                title={`${color} token ${i + 1}`}
                style={{
                  left: `calc(${((c + 0.5) / N) * 100}% + ${dx}px)`,
                  top: `calc(${((r + 0.42) / N) * 100}% + ${dy}px)`,
                  transform: "translate(-50%,-58%)",
                  transition: "left 0.28s ease, top 0.28s ease, filter 0.15s",
                  filter: clickable ? `drop-shadow(0 0 7px ${hex}) drop-shadow(0 0 2px #fff)` : "none",
                }}
                className={`absolute w-[6.4%] h-[7.6%] min-w-[20px] min-h-[24px]
                  ${clickable ? "cursor-pointer animate-bounce z-20 hover:scale-110" : "z-10 cursor-default"}`}
              >
                <svg viewBox="0 0 40 50" className="w-full h-full">
                  <defs>
                    <radialGradient id={`${gradId}-head`} cx="35%" cy="28%" r="75%">
                      <stop offset="0%" stopColor={shade(hex, 90)} />
                      <stop offset="55%" stopColor={hex} />
                      <stop offset="100%" stopColor={shade(hex, -55)} />
                    </radialGradient>
                    <linearGradient id={`${gradId}-body`} x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor={shade(hex, -45)} />
                      <stop offset="35%" stopColor={shade(hex, 45)} />
                      <stop offset="65%" stopColor={hex} />
                      <stop offset="100%" stopColor={shade(hex, -60)} />
                    </linearGradient>
                  </defs>
                  {/* ground shadow */}
                  <ellipse cx="20" cy="46.5" rx="13" ry="3.4" fill="rgba(0,0,0,0.4)" />
                  {/* base */}
                  <ellipse cx="20" cy="42" rx="12.5" ry="5.5" fill={`url(#${gradId}-body)`} stroke="rgba(0,0,0,0.35)" strokeWidth="0.6" />
                  {/* tapered body */}
                  <path d="M12.5 42 C13.5 30, 16.5 25.5, 20 24 C23.5 25.5, 26.5 30, 27.5 42 Z" fill={`url(#${gradId}-body)`} />
                  {/* collar ring */}
                  <ellipse cx="20" cy="24.5" rx="6.2" ry="2.4" fill={shade(hex, -35)} />
                  {/* head */}
                  <circle cx="20" cy="15.5" r="8.6" fill={`url(#${gradId}-head)`} stroke="rgba(0,0,0,0.25)" strokeWidth="0.5" />
                  {/* specular highlight */}
                  <ellipse cx="16.5" cy="11.5" rx="3" ry="2" fill="rgba(255,255,255,0.75)" transform="rotate(-25 16.5 11.5)" />
                </svg>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
