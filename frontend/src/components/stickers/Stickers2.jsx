/**
 * Sticker pack #2 — hand-crafted animated SVG, same rules as Stickers.jsx:
 * self-contained vectors with internal keyframes, so they scale crisply to any
 * size with zero image assets to load or license.
 *
 * Craft notes (this pack is deliberately higher-fidelity than pack #1):
 *  · gradients + inner highlights on every solid body, so nothing reads flat
 *  · secondary motion — things that move have something that trails or reacts
 *    (the rocket has exhaust, the trophy has orbiting sparkles, the bulb flickers)
 *  · easing via keySplines rather than linear interpolation
 *  · animation ids are namespaced per sticker (`stk2-*`) — two SVGs on the same
 *    page share a document, so a duplicate keyframe/gradient id silently
 *    hijacks the other's animation.
 *
 * `size` = rendered square in px.
 */

/* ── shared helpers ─────────────────────────────────────────────────────── */

const Face = ({ id, from, mid, to }) => (
  <radialGradient id={id} cx="35%" cy="28%" r="88%">
    <stop offset="0%" stopColor={from} />
    <stop offset="55%" stopColor={mid} />
    <stop offset="100%" stopColor={to} />
  </radialGradient>
);

/** Glossy highlight sold separately — makes any circle look 3D. */
const Gloss = ({ cx = 36, cy = 34, rx = 12, ry = 7, o = 0.45 }) => (
  <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="#fff" opacity={o} transform={`rotate(-28 ${cx} ${cy})`} />
);

/* ── stickers ───────────────────────────────────────────────────────────── */

export function ThumbsUpSticker({ size = 96 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <defs>
        <linearGradient id="stk2-up-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#fde68a" />
          <stop offset="55%" stopColor="#fbbf24" />
          <stop offset="100%" stopColor="#b45309" />
        </linearGradient>
      </defs>
      <style>{`
        @keyframes stk2-up-pop { 0%,100% { transform: translateY(0) rotate(-6deg) } 25% { transform: translateY(-9px) rotate(4deg) } 55% { transform: translateY(0) rotate(-2deg) } }
        @keyframes stk2-up-ring { 0% { r: 12; opacity: .55 } 100% { r: 42; opacity: 0 } }
        .stk2-up-hand { animation: stk2-up-pop 1.15s cubic-bezier(.34,1.56,.64,1) infinite; transform-origin: 52px 66px; }
        .stk2-up-ring { animation: stk2-up-ring 1.15s ease-out infinite; }
      `}</style>
      <circle className="stk2-up-ring" cx="50" cy="52" r="12" fill="none" stroke="#fbbf24" strokeWidth="3" />
      <g className="stk2-up-hand">
        {/* thumb + fist */}
        <path d="M38 52 h10 v30 h-10 a4 4 0 0 1 -4 -4 v-22 a4 4 0 0 1 4 -4 z" fill="#d97706" />
        <path
          d="M48 52 c0-6 2-9 4-13 c2-4 3-9 2-13 c-.4-2.6 1.6-4.6 4-4 c5 1.4 8 7 7.6 13 c-.2 3.4-1.4 6-2.6 8 h11
             a6 6 0 0 1 5.6 8 a6 6 0 0 1 -1.6 10 a6 6 0 0 1 -3 9 a6 6 0 0 1 -6 8 h-14 c-3 0-6-1-7-3 z"
          fill="url(#stk2-up-g)" stroke="#92400e" strokeWidth="2" strokeLinejoin="round"
        />
        <path d="M56 60 h12 M56 70 h11 M56 79 h9" stroke="#92400e" strokeWidth="1.6" opacity=".55" strokeLinecap="round" />
      </g>
    </svg>
  );
}

export function ClapSticker({ size = 96 }) {
  const hand = (dir) => (
    <g transform={`translate(${50 + dir * 4},58) scale(${dir},1)`}>
      <path
        d="M0 0 c-2-6-1-13 1-18 c1-3 5-3 5 1 l1 10 l2-14 c.5-3.4 5-3.4 5.4 0 l.6 13 l2-11 c.6-3.2 5-3 5 .4
           l-.6 12 l2.4-7 c1-3 5-2.4 4.6 1 c-1 8-2 14-5 19 c-4 6-11 8-17 5 c-4-2-6-6-6-11 z"
        fill="#fbbf24" stroke="#b45309" strokeWidth="2" strokeLinejoin="round"
      />
    </g>
  );
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <style>{`
        @keyframes stk2-clap-l { 0%,100% { transform: translateX(0) rotate(-8deg) } 50% { transform: translateX(9px) rotate(6deg) } }
        @keyframes stk2-clap-r { 0%,100% { transform: translateX(0) rotate(8deg) } 50% { transform: translateX(-9px) rotate(-6deg) } }
        @keyframes stk2-clap-burst { 0%,45% { opacity: 0; transform: scale(.4) } 55% { opacity: 1; transform: scale(1) } 100% { opacity: 0; transform: scale(1.5) } }
        .stk2-clap-l { animation: stk2-clap-l .5s ease-in-out infinite; transform-origin: 40px 70px; }
        .stk2-clap-r { animation: stk2-clap-r .5s ease-in-out infinite; transform-origin: 60px 70px; }
        .stk2-clap-b { animation: stk2-clap-burst .5s ease-out infinite; transform-origin: 50px 52px; }
      `}</style>
      <g className="stk2-clap-b">
        {[0, 60, 120, 180, 240, 300].map((a) => (
          <rect key={a} x="48.5" y="30" width="3" height="9" rx="1.5" fill="#facc15" transform={`rotate(${a} 50 52)`} />
        ))}
      </g>
      <g className="stk2-clap-l">{hand(-1)}</g>
      <g className="stk2-clap-r">{hand(1)}</g>
    </svg>
  );
}

export function PartySticker({ size = 96 }) {
  const bits = ["#f472b6", "#facc15", "#4ade80", "#60a5fa", "#c084fc", "#fb923c", "#22d3ee"];
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <defs>
        <linearGradient id="stk2-party-cone" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#f97316" />
          <stop offset="50%" stopColor="#ec4899" />
          <stop offset="100%" stopColor="#7c3aed" />
        </linearGradient>
      </defs>
      <style>{`
        @keyframes stk2-party-shake { 0%,100% { transform: rotate(-4deg) } 50% { transform: rotate(4deg) } }
        @keyframes stk2-party-fly { 0% { transform: translate(0,0) scale(.4) rotate(0deg); opacity: 0 } 15% { opacity: 1 } 100% { transform: translate(var(--dx),var(--dy)) scale(1) rotate(320deg); opacity: 0 } }
        .stk2-party-cone { animation: stk2-party-shake .6s ease-in-out infinite; transform-origin: 28px 78px; }
        .stk2-party-bit { animation: stk2-party-fly 1.5s ease-out infinite; }
      `}</style>
      {/* Static confetti spray — the sticker must READ as a party popper even
          in a still frame (a thumbnail, a screenshot, the instant it mounts).
          The animated bits are layered on top of this, not instead of it. */}
      <g opacity=".9">
        {bits.map((c, i) => {
          const a = -0.95 + i * 0.16;
          const d = 26 + (i % 3) * 9;
          return (
            <rect
              key={`static-${c}`}
              x={46 + Math.cos(a) * d} y={58 + Math.sin(a) * d}
              width="6" height="8.5" rx="1.6" fill={c}
              transform={`rotate(${i * 47} ${46 + Math.cos(a) * d} ${58 + Math.sin(a) * d})`}
            />
          );
        })}
      </g>
      {/* popper cone */}
      <g className="stk2-party-cone">
        <path d="M12 88 L40 54 L52 66 z" fill="url(#stk2-party-cone)" stroke="#4c1d95" strokeWidth="2" strokeLinejoin="round" />
        <path d="M18 82 L36 60" stroke="#fff" strokeWidth="2" opacity=".35" strokeLinecap="round" />
      </g>
      {/* animated confetti */}
      {bits.map((c, i) => (
        <rect
          key={c}
          className="stk2-party-bit"
          x="46" y="58" width="7" height="10" rx="1.8" fill={c}
          style={{
            ["--dx"]: `${14 + i * 5}px`,
            ["--dy"]: `${-14 - (i % 4) * 13}px`,
            animationDelay: `${i * 0.17}s`,
          }}
        />
      ))}
    </svg>
  );
}

export function SadSticker({ size = 96 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <defs><Face id="stk2-sad-g" from="#bfdbfe" mid="#60a5fa" to="#1d4ed8" /></defs>
      <style>{`
        @keyframes stk2-sad-slump { 0%,100% { transform: translateY(0) rotate(-2deg) } 50% { transform: translateY(4px) rotate(2deg) } }
        @keyframes stk2-sad-drop { 0% { transform: translateY(0) scale(.5); opacity: 0 } 20% { opacity: 1 } 100% { transform: translateY(26px) scale(1); opacity: 0 } }
        .stk2-sad-face { animation: stk2-sad-slump 2.2s ease-in-out infinite; transform-origin: 50px 55px; }
        .stk2-sad-tear { animation: stk2-sad-drop 1.5s ease-in infinite; }
      `}</style>
      <g className="stk2-sad-face">
        <circle cx="50" cy="54" r="34" fill="url(#stk2-sad-g)" stroke="#1e3a8a" strokeWidth="2" />
        <Gloss cx="38" cy="34" rx="13" ry="8" o={0.4} />
        {/* droopy brows + eyes */}
        <path d="M31 42 q7 -5 14 -1" stroke="#1e3a8a" strokeWidth="3.4" fill="none" strokeLinecap="round" />
        <path d="M69 42 q-7 -5 -14 -1" stroke="#1e3a8a" strokeWidth="3.4" fill="none" strokeLinecap="round" />
        <ellipse cx="39" cy="55" rx="4.6" ry="5.4" fill="#0f172a" />
        <ellipse cx="61" cy="55" rx="4.6" ry="5.4" fill="#0f172a" />
        <circle cx="40.6" cy="53" r="1.7" fill="#fff" />
        <circle cx="62.6" cy="53" r="1.7" fill="#fff" />
        {/* frown */}
        <path d="M39 74 q11 -9 22 0" stroke="#1e3a8a" strokeWidth="3.4" fill="none" strokeLinecap="round" />
      </g>
      <g className="stk2-sad-tear">
        <path d="M36 62 q-4 7 0 10 q4 -3 0 -10 z" fill="#38bdf8" />
      </g>
      <g className="stk2-sad-tear" style={{ animationDelay: "0.7s" }}>
        <path d="M64 62 q4 7 0 10 q-4 -3 0 -10 z" fill="#7dd3fc" />
      </g>
    </svg>
  );
}

export function MindBlownSticker({ size = 96 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <defs>
        <Face id="stk2-mind-g" from="#fef08a" mid="#facc15" to="#a16207" />
        <linearGradient id="stk2-mind-blast" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor="#f97316" />
          <stop offset="60%" stopColor="#fbbf24" />
          <stop offset="100%" stopColor="#fef3c7" />
        </linearGradient>
      </defs>
      <style>{`
        @keyframes stk2-mind-shake { 0%,100% { transform: translate(0,0) } 25% { transform: translate(-2px,1px) } 75% { transform: translate(2px,-1px) } }
        @keyframes stk2-mind-erupt { 0%,100% { transform: translateY(0) scale(.85); opacity: .85 } 50% { transform: translateY(-8px) scale(1.12); opacity: 1 } }
        .stk2-mind-face { animation: stk2-mind-shake .18s linear infinite; }
        .stk2-mind-top { animation: stk2-mind-erupt .8s ease-in-out infinite; transform-origin: 50px 34px; }
      `}</style>
      {/* eruption */}
      <g className="stk2-mind-top">
        <path d="M24 36 q8-18 26-20 q18 2 26 20 q-10-6-16-2 q-6-10-10-10 q-4 0-10 10 q-6-4-16 2 z" fill="url(#stk2-mind-blast)" />
        <circle cx="26" cy="20" r="3.4" fill="#fbbf24" />
        <circle cx="74" cy="18" r="2.8" fill="#f97316" />
        <circle cx="50" cy="8" r="3" fill="#fde68a" />
      </g>
      <g className="stk2-mind-face">
        <path d="M16 58 a34 34 0 0 1 68 0 v4 a34 34 0 0 1 -68 0 z" fill="url(#stk2-mind-g)" stroke="#713f12" strokeWidth="2" />
        <Gloss cx="34" cy="52" rx="11" ry="6" o={0.35} />
        {/* wide eyes */}
        <circle cx="38" cy="60" r="7.4" fill="#fff" stroke="#713f12" strokeWidth="1.6" />
        <circle cx="62" cy="60" r="7.4" fill="#fff" stroke="#713f12" strokeWidth="1.6" />
        <circle cx="38" cy="61" r="3.4" fill="#0f172a" />
        <circle cx="62" cy="61" r="3.4" fill="#0f172a" />
        {/* gaping mouth */}
        <ellipse cx="50" cy="79" rx="9" ry="7" fill="#7c2d12" />
      </g>
    </svg>
  );
}

export function CoolSticker({ size = 96 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <defs>
        <Face id="stk2-cool-g" from="#fef08a" mid="#facc15" to="#a16207" />
        <linearGradient id="stk2-cool-lens" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#1e293b" />
          <stop offset="45%" stopColor="#0f172a" />
          <stop offset="100%" stopColor="#334155" />
        </linearGradient>
      </defs>
      <style>{`
        @keyframes stk2-cool-bob { 0%,100% { transform: translateY(0) rotate(-3deg) } 50% { transform: translateY(-4px) rotate(3deg) } }
        @keyframes stk2-cool-glint { 0%,72%,100% { transform: translateX(-26px); opacity: 0 } 80% { opacity: .95 } 88% { transform: translateX(26px); opacity: 0 } }
        .stk2-cool-face { animation: stk2-cool-bob 1.8s ease-in-out infinite; transform-origin: 50px 58px; }
        .stk2-cool-glint { animation: stk2-cool-glint 2.6s ease-in-out infinite; }
      `}</style>
      <g className="stk2-cool-face">
        <circle cx="50" cy="54" r="34" fill="url(#stk2-cool-g)" stroke="#713f12" strokeWidth="2" />
        <Gloss cx="36" cy="32" rx="12" ry="7" />
        {/* shades */}
        <g>
          <rect x="24" y="45" width="22" height="15" rx="6" fill="url(#stk2-cool-lens)" />
          <rect x="54" y="45" width="22" height="15" rx="6" fill="url(#stk2-cool-lens)" />
          <path d="M46 50 q4 -3 8 0" stroke="#0f172a" strokeWidth="3.4" fill="none" />
          <path d="M24 49 L16 46 M76 49 L84 46" stroke="#0f172a" strokeWidth="3" strokeLinecap="round" />
          <clipPath id="stk2-cool-clip">
            <rect x="24" y="45" width="52" height="15" rx="6" />
          </clipPath>
          <g clipPath="url(#stk2-cool-clip)">
            <rect className="stk2-cool-glint" x="30" y="43" width="8" height="19" fill="#fff" opacity="0" transform="skewX(-20)" />
          </g>
        </g>
        {/* smirk */}
        <path d="M40 71 q10 8 20 -1" stroke="#713f12" strokeWidth="3.4" fill="none" strokeLinecap="round" />
      </g>
    </svg>
  );
}

export function RocketSticker({ size = 96 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <defs>
        <linearGradient id="stk2-rkt-body" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#94a3b8" />
          <stop offset="40%" stopColor="#f8fafc" />
          <stop offset="100%" stopColor="#64748b" />
        </linearGradient>
        <linearGradient id="stk2-rkt-fire" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fef08a" />
          <stop offset="45%" stopColor="#fb923c" />
          <stop offset="100%" stopColor="#ef4444" />
        </linearGradient>
      </defs>
      <style>{`
        @keyframes stk2-rkt-fly { 0%,100% { transform: translate(0,0) } 50% { transform: translate(2px,-7px) } }
        @keyframes stk2-rkt-flame { 0%,100% { transform: scaleY(.82) scaleX(1.05); opacity: .9 } 50% { transform: scaleY(1.2) scaleX(.9); opacity: 1 } }
        @keyframes stk2-rkt-star { 0% { transform: translateY(-8px); opacity: 0 } 30% { opacity: .9 } 100% { transform: translateY(26px); opacity: 0 } }
        .stk2-rkt { animation: stk2-rkt-fly 1s ease-in-out infinite; }
        .stk2-rkt-flame { animation: stk2-rkt-flame .22s ease-in-out infinite; transform-origin: 50px 74px; }
        .stk2-rkt-star { animation: stk2-rkt-star 1.1s linear infinite; }
      `}</style>
      {/* speed stars */}
      <circle className="stk2-rkt-star" cx="22" cy="30" r="2" fill="#e2e8f0" />
      <circle className="stk2-rkt-star" cx="78" cy="24" r="1.6" fill="#cbd5e1" style={{ animationDelay: ".35s" }} />
      <circle className="stk2-rkt-star" cx="70" cy="44" r="1.4" fill="#e2e8f0" style={{ animationDelay: ".7s" }} />
      <g className="stk2-rkt">
        <g className="stk2-rkt-flame">
          <path d="M43 72 q7 20 7 20 q0 0 7-20 q-7 5-14 0 z" fill="url(#stk2-rkt-fire)" />
        </g>
        {/* fins */}
        <path d="M38 58 q-10 8-8 18 q8-2 12-8 z" fill="#dc2626" stroke="#7f1d1d" strokeWidth="1.6" strokeLinejoin="round" />
        <path d="M62 58 q10 8 8 18 q-8-2-12-8 z" fill="#dc2626" stroke="#7f1d1d" strokeWidth="1.6" strokeLinejoin="round" />
        {/* body */}
        <path d="M50 8 c10 10 14 26 14 40 v20 h-28 v-20 c0-14 4-30 14-40 z" fill="url(#stk2-rkt-body)" stroke="#475569" strokeWidth="2" strokeLinejoin="round" />
        <circle cx="50" cy="40" r="8" fill="#38bdf8" stroke="#0369a1" strokeWidth="2" />
        <ellipse cx="47" cy="37" rx="3" ry="2" fill="#fff" opacity=".65" transform="rotate(-30 47 37)" />
        <path d="M50 8 c6 7 10 16 12 24 h-24 c2-8 6-17 12-24 z" fill="#ef4444" opacity=".9" />
      </g>
    </svg>
  );
}

export function TrophySticker({ size = 96 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <defs>
        <linearGradient id="stk2-tr-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#fef9c3" />
          <stop offset="35%" stopColor="#fbbf24" />
          <stop offset="70%" stopColor="#d97706" />
          <stop offset="100%" stopColor="#92400e" />
        </linearGradient>
      </defs>
      <style>{`
        @keyframes stk2-tr-rise { 0%,100% { transform: translateY(0) rotate(-2deg) } 50% { transform: translateY(-5px) rotate(2deg) } }
        @keyframes stk2-tr-spark { 0%,100% { opacity: 0; transform: scale(.4) } 50% { opacity: 1; transform: scale(1) } }
        @keyframes stk2-tr-shine { 0%,60%,100% { transform: translateX(-20px); opacity: 0 } 70% { opacity: .9 } 85% { transform: translateX(22px); opacity: 0 } }
        .stk2-tr { animation: stk2-tr-rise 1.9s ease-in-out infinite; transform-origin: 50px 80px; }
        .stk2-tr-sp { animation: stk2-tr-spark 1.3s ease-in-out infinite; }
        .stk2-tr-shine { animation: stk2-tr-shine 2.4s ease-in-out infinite; }
      `}</style>
      {[[20, 28, 0], [80, 24, 0.4], [26, 62, 0.8], [76, 58, 1.1]].map(([x, y, d]) => (
        <g key={`${x}-${y}`} className="stk2-tr-sp" style={{ animationDelay: `${d}s`, transformOrigin: `${x}px ${y}px` }}>
          <path d={`M${x} ${y - 6} l1.6 4.4 l4.4 1.6 l-4.4 1.6 l-1.6 4.4 l-1.6-4.4 l-4.4-1.6 l4.4-1.6 z`} fill="#fde047" />
        </g>
      ))}
      <g className="stk2-tr">
        {/* handles */}
        <path d="M32 30 h-9 a9 9 0 0 0 9 16" fill="none" stroke="#d97706" strokeWidth="4" strokeLinecap="round" />
        <path d="M68 30 h9 a9 9 0 0 1 -9 16" fill="none" stroke="#d97706" strokeWidth="4" strokeLinecap="round" />
        {/* cup */}
        <path d="M32 24 h36 v18 a18 18 0 0 1 -36 0 z" fill="url(#stk2-tr-g)" stroke="#92400e" strokeWidth="2" strokeLinejoin="round" />
        <clipPath id="stk2-tr-clip"><path d="M32 24 h36 v18 a18 18 0 0 1 -36 0 z" /></clipPath>
        <g clipPath="url(#stk2-tr-clip)">
          <rect className="stk2-tr-shine" x="36" y="20" width="9" height="44" fill="#fff" opacity="0" transform="skewX(-18)" />
        </g>
        {/* stem + base */}
        <rect x="46" y="60" width="8" height="12" fill="#b45309" />
        <rect x="36" y="72" width="28" height="7" rx="2.5" fill="#d97706" stroke="#92400e" strokeWidth="1.6" />
        <rect x="31" y="79" width="38" height="8" rx="3" fill="#b45309" stroke="#92400e" strokeWidth="1.6" />
        <text x="50" y="46" textAnchor="middle" fontSize="15" fontWeight="900" fill="#92400e">1</text>
      </g>
    </svg>
  );
}

export function ThinkSticker({ size = 96 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <defs><Face id="stk2-th-g" from="#fef08a" mid="#facc15" to="#a16207" /></defs>
      <style>{`
        @keyframes stk2-th-tilt { 0%,100% { transform: rotate(-4deg) } 50% { transform: rotate(3deg) } }
        @keyframes stk2-th-bub { 0% { transform: translateY(4px) scale(.5); opacity: 0 } 25% { opacity: .95 } 100% { transform: translateY(-16px) scale(1.1); opacity: 0 } }
        .stk2-th-face { animation: stk2-th-tilt 2.4s ease-in-out infinite; transform-origin: 50px 62px; }
        .stk2-th-b { animation: stk2-th-bub 2.2s ease-out infinite; }
      `}</style>
      {/* thought bubbles */}
      <circle className="stk2-th-b" cx="74" cy="30" r="4" fill="#e5e7eb" />
      <circle className="stk2-th-b" cx="82" cy="22" r="5.6" fill="#f3f4f6" style={{ animationDelay: ".5s" }} />
      <circle className="stk2-th-b" cx="68" cy="22" r="3" fill="#e5e7eb" style={{ animationDelay: "1s" }} />
      <g className="stk2-th-face">
        <circle cx="50" cy="56" r="33" fill="url(#stk2-th-g)" stroke="#713f12" strokeWidth="2" />
        <Gloss cx="36" cy="36" rx="11" ry="6" />
        {/* raised brow + squint */}
        <path d="M30 42 q8 -7 15 -2" stroke="#713f12" strokeWidth="3.2" fill="none" strokeLinecap="round" />
        <path d="M56 40 q7 -3 14 1" stroke="#713f12" strokeWidth="3.2" fill="none" strokeLinecap="round" />
        <circle cx="39" cy="55" r="4.2" fill="#1c1917" />
        <ellipse cx="62" cy="54" rx="5" ry="3.4" fill="#1c1917" />
        <circle cx="40.4" cy="53.4" r="1.5" fill="#fff" />
        {/* pursed mouth pulled to one side */}
        <path d="M40 72 q9 4 17 -2" stroke="#713f12" strokeWidth="3.2" fill="none" strokeLinecap="round" />
        {/* hand on chin */}
        <path d="M52 80 q-6 6 2 9 q7 2 10-4 q2-5-3-6 z" fill="#eab308" stroke="#92400e" strokeWidth="1.8" strokeLinejoin="round" />
      </g>
    </svg>
  );
}

export function SleepSticker({ size = 96 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <defs><Face id="stk2-sl-g" from="#e9d5ff" mid="#a78bfa" to="#5b21b6" /></defs>
      <style>{`
        @keyframes stk2-sl-breathe { 0%,100% { transform: scale(1) } 50% { transform: scale(1.045) } }
        @keyframes stk2-sl-z { 0% { transform: translate(0,0) scale(.5); opacity: 0 } 25% { opacity: 1 } 100% { transform: translate(16px,-26px) scale(1.2); opacity: 0 } }
        @keyframes stk2-sl-bub { 0%,100% { transform: scale(.6); opacity: .35 } 50% { transform: scale(1); opacity: .8 } }
        .stk2-sl-face { animation: stk2-sl-breathe 2.6s ease-in-out infinite; transform-origin: 50px 58px; }
        .stk2-sl-z { animation: stk2-sl-z 2.4s ease-out infinite; }
        .stk2-sl-bub { animation: stk2-sl-bub 2.6s ease-in-out infinite; transform-origin: 68px 66px; }
      `}</style>
      {["Z", "z", "z"].map((z, i) => (
        <text
          key={i} className="stk2-sl-z" x="64" y="34"
          fontSize={16 - i * 3} fontWeight="800" fill="#c4b5fd"
          style={{ animationDelay: `${i * 0.75}s` }}
        >{z}</text>
      ))}
      <g className="stk2-sl-face">
        <circle cx="50" cy="58" r="33" fill="url(#stk2-sl-g)" stroke="#4c1d95" strokeWidth="2" />
        <Gloss cx="37" cy="40" rx="11" ry="6" o={0.35} />
        {/* closed eyes */}
        <path d="M30 55 q7 6 14 0" stroke="#312e81" strokeWidth="3.4" fill="none" strokeLinecap="round" />
        <path d="M56 55 q7 6 14 0" stroke="#312e81" strokeWidth="3.4" fill="none" strokeLinecap="round" />
        {/* tiny open mouth */}
        <ellipse cx="50" cy="72" rx="4.4" ry="5.6" fill="#4c1d95" />
      </g>
      {/* snot bubble, the classic */}
      <circle className="stk2-sl-bub" cx="68" cy="66" r="7" fill="#bfdbfe" opacity=".6" stroke="#93c5fd" strokeWidth="1.2" />
    </svg>
  );
}

export function HeartEyesSticker({ size = 96 }) {
  const heart = (x, y, s) => (
    <path
      d={`M${x} ${y + 5 * s} c-${6 * s}-${4.5 * s}-${7.5 * s}-${9 * s}-${4.5 * s}-${12 * s}
          c${2.2 * s}-${2.2 * s} ${6 * s}-${1.5 * s} ${7.5 * s} ${1.5 * s}
          c${1.5 * s}-${3 * s} ${5.3 * s}-${3.7 * s} ${7.5 * s}-${1.5 * s}
          c${3 * s} ${3 * s} ${1.5 * s} ${7.5 * s}-${4.5 * s} ${12 * s} z`}
      fill="#ef4444" stroke="#991b1b" strokeWidth={1.2 * s}
    />
  );
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <defs><Face id="stk2-he-g" from="#fef08a" mid="#facc15" to="#a16207" /></defs>
      <style>{`
        @keyframes stk2-he-beat { 0%,100% { transform: scale(1) } 15% { transform: scale(1.22) } 30% { transform: scale(1.04) } 45% { transform: scale(1.14) } }
        @keyframes stk2-he-float { 0% { transform: translateY(0) scale(.4); opacity: 0 } 25% { opacity: .9 } 100% { transform: translateY(-30px) scale(1); opacity: 0 } }
        .stk2-he-l { animation: stk2-he-beat 1.1s ease-in-out infinite; transform-origin: 38px 52px; }
        .stk2-he-r { animation: stk2-he-beat 1.1s ease-in-out infinite .12s; transform-origin: 62px 52px; }
        .stk2-he-f { animation: stk2-he-float 1.8s ease-out infinite; }
      `}</style>
      <circle cx="50" cy="54" r="34" fill="url(#stk2-he-g)" stroke="#713f12" strokeWidth="2" />
      <Gloss cx="36" cy="32" rx="12" ry="7" />
      <g className="stk2-he-l">{heart(38, 48, 1.5)}</g>
      <g className="stk2-he-r">{heart(62, 48, 1.5)}</g>
      {/* open smile */}
      <path d="M36 70 q14 14 28 0 q-14 6 -28 0 z" fill="#7c2d12" />
      <path d="M36 70 q14 5 28 0" stroke="#713f12" strokeWidth="2.4" fill="none" strokeLinecap="round" />
      <g className="stk2-he-f">{heart(24, 32, 0.8)}</g>
      <g className="stk2-he-f" style={{ animationDelay: ".9s" }}>{heart(78, 30, 0.65)}</g>
    </svg>
  );
}

export function IdeaSticker({ size = 96 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <defs>
        <radialGradient id="stk2-id-glass" cx="38%" cy="32%" r="80%">
          <stop offset="0%" stopColor="#fffbeb" />
          <stop offset="55%" stopColor="#fde047" />
          <stop offset="100%" stopColor="#f59e0b" />
        </radialGradient>
      </defs>
      <style>{`
        @keyframes stk2-id-flicker { 0%,100% { opacity: 1 } 45% { opacity: .82 } 55% { opacity: 1 } 62% { opacity: .7 } }
        @keyframes stk2-id-ray { 0%,100% { opacity: .25; transform: scale(.9) } 50% { opacity: .9; transform: scale(1.08) } }
        @keyframes stk2-id-bob { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-3px) } }
        .stk2-id-bulb { animation: stk2-id-flicker 1.6s ease-in-out infinite, stk2-id-bob 2.2s ease-in-out infinite; transform-origin: 50px 50px; }
        .stk2-id-rays { animation: stk2-id-ray 1.6s ease-in-out infinite; transform-origin: 50px 44px; }
      `}</style>
      <g className="stk2-id-rays">
        {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
          <rect key={a} x="48.6" y="6" width="2.8" height="10" rx="1.4" fill="#fcd34d" transform={`rotate(${a} 50 44)`} />
        ))}
      </g>
      <g className="stk2-id-bulb">
        <path d="M50 16 a22 22 0 0 1 13 39 v6 h-26 v-6 a22 22 0 0 1 13 -39 z" fill="url(#stk2-id-glass)" stroke="#b45309" strokeWidth="2" strokeLinejoin="round" />
        {/* filament */}
        <path d="M43 46 q4-10 7-2 q3 8 7-2" stroke="#b45309" strokeWidth="2.2" fill="none" strokeLinecap="round" />
        <ellipse cx="42" cy="30" rx="5" ry="7" fill="#fff" opacity=".55" transform="rotate(-25 42 30)" />
        {/* screw base */}
        <rect x="37" y="61" width="26" height="6" rx="2" fill="#cbd5e1" stroke="#64748b" strokeWidth="1.4" />
        <rect x="38" y="68" width="24" height="5" rx="2" fill="#94a3b8" />
        <rect x="40" y="75" width="20" height="5" rx="2.4" fill="#64748b" />
        <path d="M43 84 h14" stroke="#475569" strokeWidth="4" strokeLinecap="round" />
      </g>
    </svg>
  );
}

/** Registry: kind → { Comp, sound (sfx recipe), label }. */
export const STICKERS_2 = {
  thumbsup: { Comp: ThumbsUpSticker, sound: "home", label: "Nice" },
  clap: { Comp: ClapSticker, sound: "laugh", label: "Clap" },
  party: { Comp: PartySticker, sound: "nitro", label: "Party" },
  sad: { Comp: SadSticker, sound: "move", label: "Sad" },
  mindblown: { Comp: MindBlownSticker, sound: "hit", label: "Whoa" },
  cool: { Comp: CoolSticker, sound: "home", label: "Cool" },
  rocket: { Comp: RocketSticker, sound: "nitro", label: "Let's go" },
  trophy: { Comp: TrophySticker, sound: "home", label: "Winner" },
  think: { Comp: ThinkSticker, sound: "move", label: "Hmm" },
  sleep: { Comp: SleepSticker, sound: "move", label: "Sleepy" },
  hearteyes: { Comp: HeartEyesSticker, sound: "home", label: "Adore" },
  idea: { Comp: IdeaSticker, sound: "nitro", label: "Idea" },
};
