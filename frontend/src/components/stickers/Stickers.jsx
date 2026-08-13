/**
 * Hand-crafted animated SVG stickers — the reaction system's art. Each is a
 * self-contained vector with its own internal animations (beating, flickering,
 * recoil…), so they scale crisply to any size with zero image assets to load
 * or license. `size` = rendered square in px.
 */

export function LoveSticker({ size = 96 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <defs>
        <radialGradient id="stk-love-g" cx="35%" cy="30%" r="80%">
          <stop offset="0%" stopColor="#ff8fa3" />
          <stop offset="55%" stopColor="#ef4444" />
          <stop offset="100%" stopColor="#991b1b" />
        </radialGradient>
      </defs>
      <style>{`
        @keyframes stk-love-beat { 0%,100% { transform: scale(1) } 12% { transform: scale(1.18) } 24% { transform: scale(1.02) } 36% { transform: scale(1.12) } 50% { transform: scale(1) } }
        @keyframes stk-love-rise { 0% { transform: translateY(0) scale(0.4); opacity: 0 } 30% { opacity: 1 } 100% { transform: translateY(-34px) scale(1); opacity: 0 } }
        .stk-love-heart { animation: stk-love-beat 1.2s ease-in-out infinite; transform-origin: 50px 55px; }
        .stk-love-mini { animation: stk-love-rise 1.6s ease-out infinite; transform-origin: center; }
      `}</style>
      <g className="stk-love-heart">
        <path
          d="M50 82 C20 60 12 42 20 30 C27 20 42 21 50 33 C58 21 73 20 80 30 C88 42 80 60 50 82 Z"
          fill="url(#stk-love-g)" stroke="#7f1d1d" strokeWidth="2"
        />
        <ellipse cx="36" cy="36" rx="8" ry="5" fill="#ffffff" opacity="0.5" transform="rotate(-25 36 36)" />
      </g>
      <g className="stk-love-mini" style={{ animationDelay: "0.3s" }}>
        <path d="M22 30 c-4-3-5-6-3-8 c1.5-1.5 4-1 5 1 c1-2 3.5-2.5 5-1 c2 2 1 5-3 8 z" fill="#fb7185" />
      </g>
      <g className="stk-love-mini" style={{ animationDelay: "0.9s" }}>
        <path d="M76 28 c-4-3-5-6-3-8 c1.5-1.5 4-1 5 1 c1-2 3.5-2.5 5-1 c2 2 1 5-3 8 z" fill="#f472b6" />
      </g>
    </svg>
  );
}

export function FireSticker({ size = 96 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <defs>
        <linearGradient id="stk-fire-o" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor="#7c2d12" />
          <stop offset="35%" stopColor="#ea580c" />
          <stop offset="100%" stopColor="#fbbf24" />
        </linearGradient>
        <linearGradient id="stk-fire-i" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor="#f59e0b" />
          <stop offset="100%" stopColor="#fef08a" />
        </linearGradient>
      </defs>
      <style>{`
        @keyframes stk-fire-flick { 0%,100% { transform: scaleY(1) skewX(0deg) } 30% { transform: scaleY(1.08) skewX(-3deg) } 60% { transform: scaleY(0.94) skewX(3deg) } 80% { transform: scaleY(1.05) skewX(-2deg) } }
        @keyframes stk-fire-inner { 0%,100% { transform: scaleY(1) } 50% { transform: scaleY(1.15) } }
        @keyframes stk-fire-spark { 0% { transform: translateY(0); opacity: 1 } 100% { transform: translateY(-30px); opacity: 0 } }
        .stk-fire-out { animation: stk-fire-flick 0.7s ease-in-out infinite; transform-origin: 50px 88px; }
        .stk-fire-in { animation: stk-fire-inner 0.5s ease-in-out infinite; transform-origin: 50px 85px; }
        .stk-fire-sp { animation: stk-fire-spark 1.1s ease-out infinite; }
      `}</style>
      <g className="stk-fire-out">
        <path
          d="M50 8 C54 26 70 30 72 48 C74 62 66 74 58 78 C62 68 58 60 50 54 C42 60 38 68 42 78 C34 74 26 62 28 48 C30 34 40 28 42 16 C45 24 48 22 50 8 Z"
          fill="url(#stk-fire-o)" stroke="#7c2d12" strokeWidth="2"
        />
      </g>
      <g className="stk-fire-in">
        <path d="M50 44 C56 54 60 62 56 72 C54 78 46 78 44 72 C40 62 44 54 50 44 Z" fill="url(#stk-fire-i)" />
      </g>
      <circle className="stk-fire-sp" cx="34" cy="40" r="2.4" fill="#fde047" />
      <circle className="stk-fire-sp" cx="66" cy="44" r="2" fill="#fb923c" style={{ animationDelay: "0.4s" }} />
      <circle className="stk-fire-sp" cx="52" cy="30" r="1.8" fill="#fef08a" style={{ animationDelay: "0.7s" }} />
    </svg>
  );
}

export function AngrySticker({ size = 96 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <defs>
        <radialGradient id="stk-angry-g" cx="35%" cy="30%" r="85%">
          <stop offset="0%" stopColor="#fca5a5" />
          <stop offset="55%" stopColor="#ef4444" />
          <stop offset="100%" stopColor="#7f1d1d" />
        </radialGradient>
      </defs>
      <style>{`
        @keyframes stk-angry-shake { 0%,100% { transform: translateX(0) rotate(0deg) } 20% { transform: translateX(-2.5px) rotate(-3deg) } 40% { transform: translateX(2.5px) rotate(3deg) } 60% { transform: translateX(-2px) rotate(-2deg) } 80% { transform: translateX(2px) rotate(2deg) } }
        @keyframes stk-angry-steam { 0% { transform: translateY(0) scale(0.6); opacity: 0.9 } 100% { transform: translateY(-16px) scale(1.4); opacity: 0 } }
        .stk-angry-face { animation: stk-angry-shake 0.45s linear infinite; transform-origin: 50px 55px; }
        .stk-angry-st { animation: stk-angry-steam 0.9s ease-out infinite; }
      `}</style>
      <circle className="stk-angry-st" cx="18" cy="22" r="5" fill="#e5e7eb" />
      <circle className="stk-angry-st" cx="82" cy="22" r="5" fill="#e5e7eb" style={{ animationDelay: "0.45s" }} />
      <g className="stk-angry-face">
        <circle cx="50" cy="55" r="34" fill="url(#stk-angry-g)" stroke="#450a0a" strokeWidth="2" />
        {/* furrowed brows */}
        <path d="M30 42 L45 50" stroke="#450a0a" strokeWidth="5" strokeLinecap="round" />
        <path d="M70 42 L55 50" stroke="#450a0a" strokeWidth="5" strokeLinecap="round" />
        {/* eyes */}
        <circle cx="39" cy="56" r="4" fill="#1c1917" />
        <circle cx="61" cy="56" r="4" fill="#1c1917" />
        {/* gritted mouth */}
        <rect x="38" y="68" width="24" height="7" rx="3" fill="#450a0a" />
        <line x1="44" y1="68" x2="44" y2="75" stroke="#fca5a5" strokeWidth="1.6" />
        <line x1="50" y1="68" x2="50" y2="75" stroke="#fca5a5" strokeWidth="1.6" />
        <line x1="56" y1="68" x2="56" y2="75" stroke="#fca5a5" strokeWidth="1.6" />
        {/* anger vein */}
        <path d="M68 30 l6 -6 M74 30 l-6 -6" stroke="#450a0a" strokeWidth="3" strokeLinecap="round" />
      </g>
    </svg>
  );
}

export function KissSticker({ size = 96 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <defs>
        <radialGradient id="stk-kiss-g" cx="35%" cy="30%" r="85%">
          <stop offset="0%" stopColor="#fde68a" />
          <stop offset="60%" stopColor="#fbbf24" />
          <stop offset="100%" stopColor="#b45309" />
        </radialGradient>
      </defs>
      <style>{`
        @keyframes stk-kiss-fly { 0% { transform: translate(0,0) scale(0.5); opacity: 0 } 25% { opacity: 1 } 100% { transform: translate(26px,-18px) scale(1.15); opacity: 0 } }
        @keyframes stk-kiss-wink { 0%,86%,100% { transform: scaleY(1) } 90%,96% { transform: scaleY(0.1) } }
        .stk-kiss-h { animation: stk-kiss-fly 1.5s ease-out infinite; }
        .stk-kiss-eye { animation: stk-kiss-wink 2.4s ease-in-out infinite; transform-origin: 61px 48px; }
      `}</style>
      <circle cx="46" cy="55" r="33" fill="url(#stk-kiss-g)" stroke="#92400e" strokeWidth="2" />
      {/* closed kissing eye + winking eye */}
      <path d="M28 48 q6 -6 12 0" stroke="#451a03" strokeWidth="4" strokeLinecap="round" fill="none" />
      <g className="stk-kiss-eye">
        <circle cx="61" cy="48" r="4" fill="#1c1917" />
      </g>
      {/* puckered lips */}
      <path d="M40 68 c4 -4 10 -4 12 0 c-2 4 -8 4 -12 0 z" fill="#e11d48" stroke="#9f1239" strokeWidth="1.5" />
      {/* blush */}
      <ellipse cx="30" cy="60" rx="5" ry="3" fill="#fb923c" opacity="0.55" />
      <g className="stk-kiss-h">
        <path d="M62 62 c-4-3-5-6-3-8 c1.5-1.5 4-1 5 1 c1-2 3.5-2.5 5-1 c2 2 1 5-3 8 z" fill="#f43f5e" />
      </g>
      <g className="stk-kiss-h" style={{ animationDelay: "0.7s" }}>
        <path d="M66 54 c-3-2.2-4-4.5-2.2-6 c1.1-1.1 3-0.8 3.7 0.7 c0.8-1.5 2.6-1.9 3.7-0.7 c1.6 1.5 0.8 3.8-2.2 6 z" fill="#fb7185" />
      </g>
    </svg>
  );
}

export function GunshotSticker({ size = 96 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <defs>
        <linearGradient id="stk-gun-steel" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#94a3b8" />
          <stop offset="45%" stopColor="#475569" />
          <stop offset="100%" stopColor="#1e293b" />
        </linearGradient>
        <linearGradient id="stk-gun-grip" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#78350f" />
          <stop offset="100%" stopColor="#451a03" />
        </linearGradient>
        <radialGradient id="stk-gun-fire" cx="80%" cy="50%" r="70%">
          <stop offset="0%" stopColor="#fffbeb" />
          <stop offset="40%" stopColor="#fde047" />
          <stop offset="100%" stopColor="#f97316" />
        </radialGradient>
      </defs>
      <style>{`
        @keyframes stk-gun-recoil { 0%,55%,100% { transform: rotate(0deg) translateX(0) } 60% { transform: rotate(-16deg) translateX(5px) } 74% { transform: rotate(5deg) translateX(-1px) } 86% { transform: rotate(-2deg) } }
        @keyframes stk-gun-flash { 0%,55%,88%,100% { opacity: 0; transform: scale(.25) } 60%,72% { opacity: 1; transform: scale(1.1) } }
        @keyframes stk-gun-bang { 0%,58%,100% { opacity: 0; transform: scale(.35) rotate(-10deg) } 66%,86% { opacity: 1; transform: scale(1) rotate(-10deg) } }
        @keyframes stk-gun-smoke { 0%,60%,100% { opacity: 0; transform: translate(0,0) scale(.4) } 70% { opacity: .5 } 95% { opacity: 0; transform: translate(-10px,-16px) scale(1.5) } }
        @keyframes stk-gun-shell { 0%,58%,100% { opacity: 0; transform: translate(0,0) rotate(0deg) } 64% { opacity: 1 } 92% { opacity: 0; transform: translate(16px,-6px) rotate(220deg) } }
        .stk-gun-body { animation: stk-gun-recoil 1.5s ease-in-out infinite; transform-origin: 52px 64px; }
        .stk-gun-fl { animation: stk-gun-flash 1.5s ease-out infinite; transform-origin: 20px 48px; }
        .stk-gun-bg { animation: stk-gun-bang 1.5s ease-out infinite; transform-origin: 68px 24px; }
        .stk-gun-sm { animation: stk-gun-smoke 1.5s ease-out infinite; }
        .stk-gun-sh { animation: stk-gun-shell 1.5s ease-out infinite; }
      `}</style>

      {/* smoke puffs */}
      <circle className="stk-gun-sm" cx="20" cy="44" r="5" fill="#cbd5e1" />
      <circle className="stk-gun-sm" cx="14" cy="50" r="3.6" fill="#e2e8f0" style={{ animationDelay: ".06s" }} />

      {/* muzzle flash — layered star + core for depth */}
      <g className="stk-gun-fl">
        <path d="M24 48 L6 38 L16 48 L2 48 L16 52 L6 60 Z" fill="url(#stk-gun-fire)" />
        <path d="M23 48 L12 42 L18 48 L11 54 Z" fill="#fffbeb" />
        <circle cx="23" cy="48" r="4.5" fill="#fff" opacity=".95" />
      </g>

      {/* ejected shell */}
      <rect className="stk-gun-sh" x="56" y="38" width="4.5" height="8" rx="1.6" fill="#fbbf24" stroke="#b45309" strokeWidth=".8" />

      <g className="stk-gun-body">
        {/* grip */}
        <path d="M58 56 l14 0 l-6 26 a4 4 0 0 1 -4 3 h-6 a3 3 0 0 1 -3 -4 z" fill="url(#stk-gun-grip)" stroke="#1c1917" strokeWidth="2" strokeLinejoin="round" />
        <path d="M60 62 h9 M59 68 h9 M58 74 h8" stroke="#1c1917" strokeWidth="1.4" opacity=".5" strokeLinecap="round" />
        {/* trigger guard */}
        <path d="M44 58 a10 10 0 0 0 10 8" stroke="#1e293b" strokeWidth="3.4" fill="none" strokeLinecap="round" />
        <path d="M48 58 q1 5 4 6" stroke="#0f172a" strokeWidth="2.6" fill="none" strokeLinecap="round" />
        {/* frame + slide */}
        <rect x="22" y="44" width="50" height="14" rx="3.5" fill="url(#stk-gun-steel)" stroke="#0f172a" strokeWidth="2" />
        <rect x="24" y="45.5" width="46" height="4" rx="2" fill="#94a3b8" opacity=".75" />
        <rect x="30" y="52" width="24" height="2.4" rx="1.2" fill="#0f172a" opacity=".45" />
        {/* sights */}
        <rect x="26" y="41.5" width="4" height="3.5" rx="1" fill="#0f172a" />
        <rect x="64" y="41.5" width="5" height="3.5" rx="1" fill="#0f172a" />
        {/* barrel opening */}
        <circle cx="24" cy="51" r="2.6" fill="#020617" />
      </g>

      {/* BANG! */}
      <g className="stk-gun-bg">
        <path d="M68 12 l4 8 8-6 -2 9 10 1 -8 6 7 6 -10-1 1 10 -7-7 -5 9 -1-10 -9 4 6-8 -9-3 10-3 -4-9 8 4 z" fill="#f59e0b" stroke="#b45309" strokeWidth="1.6" strokeLinejoin="round" />
        <text x="68" y="28" textAnchor="middle" fontSize="11" fontWeight="900" fill="#7c2d12" transform="rotate(-10 68 24)">BANG</text>
      </g>
    </svg>
  );
}

export function LaughSticker({ size = 96 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <defs>
        <radialGradient id="stk-laugh-g" cx="35%" cy="30%" r="85%">
          <stop offset="0%" stopColor="#fef08a" />
          <stop offset="60%" stopColor="#facc15" />
          <stop offset="100%" stopColor="#a16207" />
        </radialGradient>
      </defs>
      <style>{`
        @keyframes stk-laugh-rock { 0%,100% { transform: rotate(-6deg) } 50% { transform: rotate(6deg) } }
        @keyframes stk-laugh-tear { 0% { transform: translateY(0) scale(0.7); opacity: 0 } 30% { opacity: 1 } 100% { transform: translateY(16px) scale(1.1); opacity: 0 } }
        .stk-laugh-face { animation: stk-laugh-rock 0.55s ease-in-out infinite; transform-origin: 50px 55px; }
        .stk-laugh-t { animation: stk-laugh-tear 0.9s ease-in infinite; }
      `}</style>
      <g className="stk-laugh-face">
        <circle cx="50" cy="55" r="34" fill="url(#stk-laugh-g)" stroke="#713f12" strokeWidth="2" />
        {/* laughing closed eyes */}
        <path d="M30 47 q7 -8 14 0" stroke="#451a03" strokeWidth="4.5" strokeLinecap="round" fill="none" />
        <path d="M56 47 q7 -8 14 0" stroke="#451a03" strokeWidth="4.5" strokeLinecap="round" fill="none" />
        {/* big open mouth */}
        <path d="M32 60 q18 22 36 0 q-4 16 -18 16 q-14 0 -18 -16 z" fill="#7c2d12" />
        <path d="M36 66 q14 12 28 0 q-4 8 -14 8 q-10 0 -14 -8 z" fill="#fda4af" />
        <rect x="34" y="59" width="32" height="4.5" rx="2" fill="#ffffff" />
      </g>
      {/* flying tears */}
      <g className="stk-laugh-t">
        <path d="M16 50 q-4 6 0 9 q4 -3 0 -9 z" fill="#38bdf8" />
      </g>
      <g className="stk-laugh-t" style={{ animationDelay: "0.45s" }}>
        <path d="M84 50 q4 6 0 9 q-4 -3 0 -9 z" fill="#7dd3fc" />
      </g>
    </svg>
  );
}

/** Registry: kind → { Comp, sound (sfx recipe), label }. */
export const STICKERS = {
  love: { Comp: LoveSticker, sound: "home", label: "Love" },
  laugh: { Comp: LaughSticker, sound: "laugh", label: "Haha" },
  fire: { Comp: FireSticker, sound: "nitro", label: "Fire" },
  kiss: { Comp: KissSticker, sound: "move", label: "Kiss" },
  angry: { Comp: AngrySticker, sound: "hit", label: "Grr" },
  gunshot: { Comp: GunshotSticker, sound: "shoot", label: "Bang" },
};
