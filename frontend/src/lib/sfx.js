/**
 * Sound engine for all mini-games — 100% synthesized with WebAudio.
 *
 * WHY synthesis instead of audio files: zero assets to license, host, or load
 * (matters on free-tier hosting), and retro-arcade blips fit the games' vibe.
 * Every effect is a tiny recipe of oscillators/noise through an envelope.
 *
 * Browser autoplay policy: an AudioContext starts "suspended" until a user
 * gesture. `unlock()` is registered once on pointerdown/keydown, so audio
 * simply begins working at the first interaction — no permission UI needed.
 *
 * Public API:
 *   sfx.play(name)            — fire-and-forget effect (no-op when muted)
 *   sfx.engine.start/update/stop — the kart's continuous engine hum
 *   music.start(track)        — looping generative background music
 *   music.stop()
 *   getMuted() / setMuted(b)  — persisted in localStorage
 */

const MUTE_KEY = "groot:muted";

let ctx = null;
let master = null; // all SFX
let musicBus = null; // music quieter than SFX
let muted = localStorage.getItem(MUTE_KEY) === "1";

function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.5;
    master.connect(ctx.destination);
    musicBus = ctx.createGain();
    musicBus.gain.value = 0.16;
    musicBus.connect(master);
  }
  // NOTE: no resume() here. This is called from per-frame paths (engine hum),
  // and resume() before a user gesture allocates a rejected promise + console
  // warning EVERY call — 60/s of pure garbage. The unlock listener resumes.
  return ctx;
}

// True once the context is actually producing sound.
const running = () => ctx && ctx.state === "running";

// One shared noise buffer (2s of white noise) reused by every noisy effect.
let noiseBuf = null;
function noise() {
  const c = ac();
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const src = c.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  return src;
}

export function getMuted() {
  return muted;
}
export function setMuted(b) {
  muted = b;
  localStorage.setItem(MUTE_KEY, b ? "1" : "0");
  if (master) master.gain.value = b ? 0 : 0.5;
}

// Register the autoplay unlock exactly once, at module load.
if (typeof window !== "undefined") {
  const unlock = () => {
    const c = ac();
    if (c && c.state === "suspended") c.resume().catch(() => {});
  };
  window.addEventListener("pointerdown", unlock, { passive: true });
  window.addEventListener("keydown", unlock);
}

// ── Building blocks ──────────────────────────────────────────────────────────

// A single oscillator with pitch + gain envelopes. Everything is scheduled on
// the audio clock, so effects are sample-accurate regardless of frame rate.
function tone({ type = "square", from = 440, to = from, dur = 0.15, vol = 0.3, delay = 0, curve = "exp" }) {
  const c = ac();
  if (!c || muted || !running()) return;
  const t0 = c.currentTime + delay;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(Math.max(1, from), t0);
  if (to !== from) {
    if (curve === "exp") o.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + dur);
    else o.frequency.linearRampToValueAtTime(Math.max(1, to), t0 + dur);
  }
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  o.connect(g).connect(master);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

// A burst of filtered noise — explosions, shotguns, skids.
function noiseBurst({ dur = 0.3, vol = 0.4, delay = 0, filterFrom = 2000, filterTo = 200, q = 0.8 }) {
  const c = ac();
  if (!c || muted || !running()) return;
  const t0 = c.currentTime + delay;
  const src = noise();
  const f = c.createBiquadFilter();
  f.type = "lowpass";
  f.Q.value = q;
  f.frequency.setValueAtTime(filterFrom, t0);
  f.frequency.exponentialRampToValueAtTime(Math.max(40, filterTo), t0 + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t0);
  src.stop(t0 + dur + 0.02);
}

// ── Effect recipes ───────────────────────────────────────────────────────────

const RECIPES = {
  // Kart weapons
  shoot: () => tone({ type: "square", from: 880, to: 220, dur: 0.09, vol: 0.16 }),
  shotgun: () => {
    noiseBurst({ dur: 0.22, vol: 0.4, filterFrom: 3200, filterTo: 300 });
    tone({ type: "square", from: 180, to: 60, dur: 0.18, vol: 0.22 });
  },
  laser: () => {
    tone({ type: "sawtooth", from: 2400, to: 180, dur: 0.28, vol: 0.2 });
    tone({ type: "sine", from: 3600, to: 400, dur: 0.2, vol: 0.1 });
  },
  homing: () => noiseBurst({ dur: 0.5, vol: 0.18, filterFrom: 500, filterTo: 2800, q: 2.5 }),
  explosion: () => {
    noiseBurst({ dur: 0.7, vol: 0.5, filterFrom: 1400, filterTo: 60 });
    tone({ type: "sine", from: 120, to: 32, dur: 0.6, vol: 0.4 });
  },
  mineBlast: () => {
    noiseBurst({ dur: 0.4, vol: 0.4, filterFrom: 1800, filterTo: 100 });
    tone({ type: "sine", from: 150, to: 40, dur: 0.35, vol: 0.3 });
  },
  freeze: () => {
    tone({ type: "sine", from: 1200, to: 2600, dur: 0.35, vol: 0.14 });
    tone({ type: "sine", from: 1207, to: 2612, dur: 0.35, vol: 0.14 }); // detuned shimmer
  },
  // Kart status
  pickup: () => {
    tone({ type: "square", from: 660, dur: 0.07, vol: 0.14 });
    tone({ type: "square", from: 880, dur: 0.07, vol: 0.14, delay: 0.07 });
    tone({ type: "square", from: 1320, dur: 0.1, vol: 0.14, delay: 0.14 });
  },
  nitro: () => noiseBurst({ dur: 0.6, vol: 0.3, filterFrom: 300, filterTo: 4000, q: 3 }),
  shieldUp: () => tone({ type: "triangle", from: 300, to: 900, dur: 0.25, vol: 0.2 }),
  spikes: () => {
    tone({ type: "square", from: 220, dur: 0.05, vol: 0.2 });
    tone({ type: "square", from: 170, dur: 0.08, vol: 0.2, delay: 0.06 });
  },
  ghost: () => tone({ type: "sine", from: 700, to: 140, dur: 0.5, vol: 0.16, curve: "lin" }),
  oil: () => tone({ type: "sine", from: 240, to: 90, dur: 0.25, vol: 0.2 }),
  skid: () => noiseBurst({ dur: 0.35, vol: 0.2, filterFrom: 1200, filterTo: 500, q: 4 }),
  kill: () => {
    tone({ type: "square", from: 523, dur: 0.09, vol: 0.2 });
    tone({ type: "square", from: 784, dur: 0.14, vol: 0.2, delay: 0.09 });
  },
  death: () => tone({ type: "sawtooth", from: 400, to: 60, dur: 0.6, vol: 0.25 }),
  hit: () => tone({ type: "square", from: 200, to: 120, dur: 0.08, vol: 0.15 }),
  countdown: () => tone({ type: "square", from: 660, dur: 0.1, vol: 0.18 }),
  // Shared
  win: () => [523, 659, 784, 1047].forEach((f, i) => tone({ type: "triangle", from: f, dur: 0.22, vol: 0.2, delay: i * 0.13 })),
  lose: () => [392, 330, 262, 196].forEach((f, i) => tone({ type: "triangle", from: f, dur: 0.25, vol: 0.18, delay: i * 0.15 })),
  // Ludo
  dice: () => [0, 0.06, 0.13, 0.21].forEach((d) => tone({ type: "square", from: 320 + Math.random() * 240, dur: 0.04, vol: 0.14, delay: d })),
  move: () => tone({ type: "sine", from: 520, to: 640, dur: 0.09, vol: 0.18 }),
  capture: () => tone({ type: "sawtooth", from: 700, to: 120, dur: 0.3, vol: 0.22 }),
  home: () => {
    tone({ type: "triangle", from: 784, dur: 0.1, vol: 0.2 });
    tone({ type: "triangle", from: 1175, dur: 0.16, vol: 0.2, delay: 0.1 });
  },
  yourTurn: () => tone({ type: "triangle", from: 587, to: 880, dur: 0.16, vol: 0.16 }),
  // Skribbl
  correct: () => [659, 880, 1319].forEach((f, i) => tone({ type: "triangle", from: f, dur: 0.14, vol: 0.2, delay: i * 0.09 })),
  roundStart: () => tone({ type: "square", from: 440, to: 880, dur: 0.18, vol: 0.16 }),
  tick: () => tone({ type: "sine", from: 990, dur: 0.05, vol: 0.12 }),
};

export const sfx = {
  play(name) {
    try {
      RECIPES[name]?.();
    } catch {
      /* audio must never break the game */
    }
  },

  // Continuous kart engine hum: two detuned saws through a lowpass, pitch and
  // volume follow speed. update() is safe to call every frame (param sets only).
  engine: {
    nodes: null,
    start() {
      const c = ac();
      if (!c || this.nodes) return;
      const g = c.createGain();
      g.gain.value = 0;
      const f = c.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = 400;
      const o1 = c.createOscillator();
      const o2 = c.createOscillator();
      o1.type = "sawtooth";
      o2.type = "sawtooth";
      o1.frequency.value = 55;
      o2.frequency.value = 55.8;
      o1.connect(f);
      o2.connect(f);
      f.connect(g).connect(master);
      o1.start();
      o2.start();
      this.nodes = { g, f, o1, o2 };
    },
    update(speedNorm) {
      // speedNorm 0..1 — idle putter to full snarl. Cheap param sets only, and
      // a hard no-op until the context is actually running.
      if (!this.nodes || muted || !running()) return;
      const s = Math.min(1, Math.max(0, speedNorm));
      const c = ac();
      const t = c.currentTime;
      this.nodes.o1.frequency.setTargetAtTime(50 + s * 130, t, 0.08);
      this.nodes.o2.frequency.setTargetAtTime(50.8 + s * 132, t, 0.08);
      this.nodes.f.frequency.setTargetAtTime(300 + s * 1400, t, 0.1);
      this.nodes.g.gain.setTargetAtTime(0.05 + s * 0.09, t, 0.1);
    },
    stop() {
      if (!this.nodes) return;
      const { g, o1, o2 } = this.nodes;
      const t = ac().currentTime;
      g.gain.setTargetAtTime(0, t, 0.1);
      o1.stop(t + 0.5);
      o2.stop(t + 0.5);
      this.nodes = null;
    },
  },
};

// ── Music: a tiny generative step sequencer ──────────────────────────────────
// Each track is { bpm, bass[], lead[], hat } over a 16-step loop (0 = rest,
// numbers are semitones above the root). Scheduled with the standard WebAudio
// lookahead pattern so timing stays tight even when the tab hiccups.

const TRACKS = {
  kart: {
    bpm: 132, root: 110, // A2 — driving minor groove
    bass: [0, 0, 12, 0, 3, 0, 12, 0, 5, 0, 12, 0, 3, 0, 7, 10],
    lead: [12, 0, 15, 0, 0, 19, 0, 15, 12, 0, 10, 0, 15, 0, 12, 0],
    hat: true,
  },
  ludo: {
    bpm: 96, root: 147, // D3 — relaxed board-game plucks
    bass: [0, 0, 7, 0, 5, 0, 7, 0, 0, 0, 7, 0, 9, 0, 7, 5],
    lead: [12, 0, 0, 16, 0, 12, 0, 0, 14, 0, 0, 12, 0, 0, 16, 0],
    hat: false,
  },
  skribbl: {
    bpm: 112, root: 131, // C3 — playful major bounce
    bass: [0, 0, 4, 0, 7, 0, 4, 0, 5, 0, 9, 0, 7, 0, 4, 0],
    lead: [12, 0, 16, 0, 0, 12, 19, 0, 17, 0, 12, 0, 16, 0, 0, 12],
    hat: true,
  },
};

const seq = { timer: null, step: 0, nextAt: 0, track: null };

function scheduleStep(c, tr, step, t) {
  const semi = (n) => tr.root * Math.pow(2, n / 12);
  const b = tr.bass[step % 16];
  if (b || step % 16 === 0) {
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = "triangle";
    o.frequency.value = semi(b) / 2;
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    o.connect(g).connect(musicBus);
    o.start(t);
    o.stop(t + 0.25);
  }
  const l = tr.lead[step % 16];
  if (l) {
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = "square";
    o.frequency.value = semi(l);
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    o.connect(g).connect(musicBus);
    o.start(t);
    o.stop(t + 0.18);
  }
  if (tr.hat && step % 2 === 0) {
    const src = noise();
    const f = c.createBiquadFilter();
    f.type = "highpass";
    f.frequency.value = 6000;
    const g = c.createGain();
    g.gain.setValueAtTime(step % 4 === 0 ? 0.1 : 0.05, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    src.connect(f).connect(g).connect(musicBus);
    src.start(t);
    src.stop(t + 0.06);
  }
}

export const music = {
  start(name) {
    const c = ac();
    const tr = TRACKS[name];
    if (!c || !tr) return;
    if (seq.track === name && seq.timer) return; // already playing this
    this.stop();
    seq.track = name;
    seq.step = 0;
    seq.nextAt = c.currentTime + 0.1;
    const stepDur = 60 / tr.bpm / 4; // 16th notes
    seq.timer = setInterval(() => {
      // Silent while muted OR suspended — otherwise notes queue on the paused
      // audio clock and burst out all at once when the context resumes.
      if (muted || !running()) return;
      // Schedule everything due in the next 200ms (lookahead pattern).
      while (seq.nextAt < c.currentTime + 0.2) {
        scheduleStep(c, tr, seq.step, seq.nextAt);
        seq.step = (seq.step + 1) % 16;
        seq.nextAt += stepDur;
      }
    }, 90);
  },
  stop() {
    if (seq.timer) clearInterval(seq.timer);
    seq.timer = null;
    seq.track = null;
  },
};
