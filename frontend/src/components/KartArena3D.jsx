import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { getMap } from "@/games/kartMaps.js";

/**
 * The 3D renderer for Smash Karts. It owns NO game logic — it draws the world
 * snapshots the server streams (via `snapRef`) into a Three.js scene with a
 * chase camera behind the local player's kart. Server 2D (x, y) becomes the
 * ground plane (x, z); heading becomes yaw.
 *
 * Map-dependent geometry (floor/walls/track/decor/ambient FX) is (re)built
 * from the snapshot's `mapId` and driven entirely by the map's `theme` fields;
 * everything else (renderer, composer, camera, lights, kart models) is built
 * once. Curvy maps carry a `shape` block (spline-sampled loops): the floor
 * becomes a Shape ribbon (ring maps get an infield island), and the barrier
 * capsule chain is rendered as continuous curved rails / rock rims instead of
 * per-capsule meshes. React is used only for the DOM HUD overlay.
 *
 * Rendering pipeline: RenderPass → UnrealBloom → OutputPass (ACES tone map +
 * sRGB). Bloom is what makes neon trim, lava cracks, headlights and bullets
 * actually GLOW instead of just being bright pixels.
 */

const ARENA_W = 1600; // default world (rect maps); shaped maps override via map.w/h
const ARENA_H = 900;
const SNAP_INTERVAL = 70;

const COLOR_HEX = {
  red: "#ef4444", blue: "#3b82f6", green: "#22c55e",
  yellow: "#eab308", orange: "#f97316", purple: "#a855f7",
};
const COLOR_INT = {
  red: 0xef4444, blue: 0x3b82f6, green: 0x22c55e,
  yellow: 0xeab308, orange: 0xf97316, purple: 0xa855f7,
};
const TEAM_HEX = { A: "#3b82f6", B: "#ef4444" };
const TEAM_INT = { A: 0x3b82f6, B: 0xef4444 };

// Pickup type → color + emoji shown floating above the pad.
const PICKUP_META = {
  health: { color: 0x22c55e, emoji: "❤️" },
  rapid: { color: 0xf97316, emoji: "🔥" },
  speed: { color: 0x22d3ee, emoji: "⚡" },
  shield: { color: 0x3b82f6, emoji: "🛡️" },
  bomb: { color: 0xef4444, emoji: "💀" },
};

const fmtTime = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return a + d * t;
}
function angleDelta(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// Deterministic PRNG so decorations land in the same spots every rebuild.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Procedural canvas textures ──────────────────────────────────────────────

function canvasTex(w, h, draw) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function gradientTexture(stops) {
  const tex = canvasTex(4, 256, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, stops[0]);
    g.addColorStop(0.5, stops[1]);
    g.addColorStop(1, stops[2]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 4, 256);
  });
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

// Soft radial glow — shared by dust, clouds, flashes, flares, bullet halos.
function glowTexture() {
  const tex = canvasTex(64, 64, (ctx) => {
    const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.4, "rgba(255,255,255,0.45)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  });
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

function leafTexture() {
  const tex = canvasTex(16, 16, (ctx) => {
    ctx.fillStyle = "#9fbf4a";
    ctx.beginPath();
    ctx.ellipse(8, 8, 6, 3.2, 0.7, 0, Math.PI * 2);
    ctx.fill();
  });
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

function asphaltTexture() {
  return canvasTex(256, 256, (ctx, w, h) => {
    const rnd = mulberry32(7);
    ctx.fillStyle = "#23262e";
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 2200; i++) {
      const v = 24 + Math.floor(rnd() * 34);
      ctx.fillStyle = `rgb(${v},${v + 2},${v + 6})`;
      ctx.fillRect(rnd() * w, rnd() * h, 1.6, 1.6);
    }
    // Faint tyre scuff arcs.
    ctx.strokeStyle = "rgba(10,10,14,0.25)";
    ctx.lineWidth = 3;
    for (let i = 0; i < 7; i++) {
      ctx.beginPath();
      ctx.arc(rnd() * w, rnd() * h, 30 + rnd() * 60, rnd() * 6, rnd() * 6 + 1.2);
      ctx.stroke();
    }
  });
}

function grassTexture() {
  return canvasTex(256, 256, (ctx, w, h) => {
    const rnd = mulberry32(13);
    ctx.fillStyle = "#2c5133";
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 60; i++) {
      ctx.fillStyle = rnd() > 0.5 ? "rgba(58,107,63,0.35)" : "rgba(35,66,39,0.4)";
      ctx.beginPath();
      ctx.ellipse(rnd() * w, rnd() * h, 12 + rnd() * 26, 8 + rnd() * 18, rnd() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = 0; i < 1400; i++) {
      const g = 90 + Math.floor(rnd() * 70);
      ctx.fillStyle = `rgba(${g * 0.45},${g},${g * 0.4},0.5)`;
      ctx.fillRect(rnd() * w, rnd() * h, 1.4, 2.6);
    }
  });
}

function sandTexture() {
  return canvasTex(256, 256, (ctx, w, h) => {
    const rnd = mulberry32(23);
    ctx.fillStyle = "#c2a678";
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 1800; i++) {
      const v = 165 + Math.floor(rnd() * 55);
      ctx.fillStyle = `rgba(${v},${v - 28},${v - 70},0.5)`;
      ctx.fillRect(rnd() * w, rnd() * h, 1.6, 1.6);
    }
    // Wind ripples.
    ctx.strokeStyle = "rgba(120,90,55,0.25)";
    ctx.lineWidth = 2;
    for (let i = 0; i < 12; i++) {
      ctx.beginPath();
      ctx.arc(rnd() * w, rnd() * h, 24 + rnd() * 50, rnd() * 3, rnd() * 3 + 1.6);
      ctx.stroke();
    }
  });
}

// Basalt returns BOTH an albedo and an emissive map — the same crack polylines
// are stroked dark on the albedo and hot orange on the emissive, so the glow
// sits exactly in the cracks (bloom does the rest).
function basaltTextures() {
  const rnd = mulberry32(29);
  const cracks = [];
  for (let i = 0; i < 9; i++) {
    const pts = [[rnd() * 256, rnd() * 256]];
    for (let s = 0; s < 6; s++) {
      const [px, py] = pts[pts.length - 1];
      pts.push([px + (rnd() - 0.5) * 90, py + (rnd() - 0.5) * 90]);
    }
    cracks.push(pts);
  }
  const stroke = (ctx, pts) => {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.stroke();
  };
  const map = canvasTex(256, 256, (ctx, w, h) => {
    const r2 = mulberry32(31);
    ctx.fillStyle = "#1f1d22";
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 1800; i++) {
      const v = 22 + Math.floor(r2() * 26);
      ctx.fillStyle = `rgb(${v + 4},${v},${v + 2})`;
      ctx.fillRect(r2() * w, r2() * h, 1.8, 1.8);
    }
    ctx.strokeStyle = "#0b0a0e";
    ctx.lineWidth = 4;
    for (const pts of cracks) stroke(ctx, pts);
  });
  const emissiveMap = canvasTex(256, 256, (ctx, w, h) => {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);
    ctx.shadowColor = "#ff4a00";
    ctx.shadowBlur = 7;
    ctx.strokeStyle = "#ff6a1a";
    ctx.lineWidth = 2.5;
    for (const pts of cracks) stroke(ctx, pts);
  });
  return { map, emissiveMap };
}

function crowdTexture() {
  return canvasTex(128, 64, (ctx, w, h) => {
    const rnd = mulberry32(41);
    const palette = ["#e2b25f", "#c8dff2", "#e07070", "#7fc48a", "#8f8fd8", "#d8c26e", "#c9c9c9"];
    ctx.fillStyle = "#10141c";
    ctx.fillRect(0, 0, w, h);
    for (let y = 5; y < h; y += 7) {
      for (let x = 3; x < w; x += 5) {
        ctx.fillStyle = palette[Math.floor(rnd() * palette.length)];
        ctx.beginPath();
        ctx.arc(x + rnd() * 2, y + rnd() * 2, 1.7, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  });
}

function billboardTexture(text) {
  const tex = canvasTex(256, 64, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, "#0ea5e9");
    g.addColorStop(1, "#8b5cf6");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.fillRect(0, h - 10, w, 10);
    ctx.font = "bold 34px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#ffffff";
    ctx.fillText(text, w / 2, h / 2 - 2);
  });
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

function checkerTexture() {
  const tex = canvasTex(128, 32, (ctx) => {
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 8; x++) {
        ctx.fillStyle = (x + y) % 2 ? "#0c0c10" : "#f3f4f6";
        ctx.fillRect(x * 16, y * 16, 16, 16);
      }
    }
  });
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

export default function KartArena3D({ snapRef, killFeedRef, boomsRef, myId }) {
  const mountRef = useRef(null);
  const [hud, setHud] = useState({ timeLeft: 0, board: [], me: null, feed: [], mode: "ffa", teamScores: null });

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    // Active world dimensions — updated by buildMap for oversized shaped maps.
    const dims = { w: ARENA_W, h: ARENA_H, cx: ARENA_W / 2, cz: ARENA_H / 2 };

    // ── Renderer + post-processing ──
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    let w = mount.clientWidth || 800;
    let h = mount.clientHeight || Math.round((w * ARENA_H) / ARENA_W);
    renderer.setSize(w, h);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x0b1424, 1600, 3400);

    const camera = new THREE.PerspectiveCamera(62, w / h, 1, 12000);
    camera.position.set(dims.cx, 700, dims.h + 700);
    camera.lookAt(dims.cx, 0, dims.cz);

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 0.55, 0.65, 0.85);
    composer.addPass(bloomPass);
    composer.addPass(new OutputPass());

    // ── Lights (retuned per map theme) ──
    const hemi = new THREE.HemisphereLight(0xbcd4ff, 0x0c1524, 0.9);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 1.5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 200;
    sun.shadow.camera.far = 5200;
    sun.shadow.bias = -0.0005;
    scene.add(sun, sun.target);

    // ── Shared textures (created once, never disposed per-map) ──
    const glowTex = glowTexture();
    const leafTex = leafTexture();

    // ── Map-dependent geometry lives in one group we can rebuild ──
    const mapGroup = new THREE.Group();
    scene.add(mapGroup);
    let builtMapId = null;
    let curTheme = null;
    let mapFx = {}; // per-map animated bits: motes/flashes/clouds/smoke/lava
    let mapDisposables = []; // per-map textures to free on rebuild

    function disposeGroup(group) {
      group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
      });
      group.clear();
      for (const t of mapDisposables) t.dispose();
      mapDisposables = [];
      mapFx = {};
    }

    // ── Obstacle builders (visual style comes from the theme) ──
    function buildLog(o, theme) {
      const dx = o.x2 - o.x1, dz = o.y2 - o.y1;
      const len = Math.hypot(dx, dz);
      const g = new THREE.Group();
      if (theme.log === "basalt") {
        // A ridge of chunky hex prisms instead of a wooden log.
        const mat = new THREE.MeshStandardMaterial({ color: 0x2c2531, roughness: 0.9 });
        const n = Math.max(3, Math.round(len / 46));
        for (let i = 0; i < n; i++) {
          const hgt = o.r * (2.2 + ((i * 37) % 10) / 9);
          const p = new THREE.Mesh(new THREE.CylinderGeometry(o.r * 0.95, o.r * 1.1, hgt, 6), mat);
          p.position.set(-len / 2 + (i + 0.5) * (len / n), hgt / 2, 0);
          p.rotation.y = i * 0.6;
          p.castShadow = true;
          g.add(p);
        }
      } else {
        const mat = new THREE.MeshStandardMaterial({ color: 0x6b4423, roughness: 0.9 });
        const capMat = new THREE.MeshStandardMaterial({ color: 0xa8874f, roughness: 0.85 });
        const cyl = new THREE.Mesh(new THREE.CylinderGeometry(o.r, o.r, len, 12), mat);
        cyl.rotation.z = Math.PI / 2; // lay along local X
        cyl.castShadow = true;
        g.add(cyl);
        for (const side of [-1, 1]) {
          const cap = new THREE.Mesh(new THREE.CylinderGeometry(o.r * 0.98, o.r * 0.98, 2, 12), capMat);
          cap.rotation.z = Math.PI / 2;
          cap.position.x = side * (len / 2);
          g.add(cap);
        }
      }
      g.position.set((o.x1 + o.x2) / 2, theme.log === "basalt" ? 0 : o.r, (o.y1 + o.y2) / 2);
      g.rotation.y = -Math.atan2(dz, dx);
      return g;
    }

    function buildCircle(o, theme) {
      const g = new THREE.Group();
      if (theme.circle === "rock") {
        const mat = new THREE.MeshStandardMaterial({ color: 0x6b7280, roughness: 0.95, flatShading: true });
        const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(o.r * 1.05, 0), mat);
        rock.position.y = o.r * 0.75;
        rock.scale.y = 0.78;
        rock.rotation.set(0.4, o.x * 0.01, 0.2);
        rock.castShadow = true;
        g.add(rock);
        const pebble = new THREE.Mesh(new THREE.DodecahedronGeometry(o.r * 0.4, 0), mat);
        pebble.position.set(o.r * 0.75, o.r * 0.22, o.r * 0.4);
        pebble.castShadow = true;
        g.add(pebble);
      } else {
        const mat = new THREE.MeshStandardMaterial({ color: 0x0d0f14, roughness: 0.95 });
        const stripeMat = new THREE.MeshStandardMaterial({ color: 0xe5e7eb, roughness: 0.8 });
        for (let i = 0; i < 3; i++) {
          const t = new THREE.Mesh(new THREE.TorusGeometry(o.r * 0.82, o.r * 0.3, 10, 20), i === 1 ? stripeMat : mat);
          t.rotation.x = Math.PI / 2;
          t.position.y = o.r * 0.3 + i * o.r * 0.52;
          t.castShadow = true;
          g.add(t);
        }
      }
      g.position.set(o.x, 0, o.y);
      return g;
    }

    // ── Shaped-track pieces (curvy maps) ──
    const loopToShapePts = (loop) => loop.map((p) => new THREE.Vector2(p.x, -p.y));

    function buildShapedFloor(shape, theme) {
      const outerShape = new THREE.Shape(loopToShapePts(shape.outer));
      if (shape.kind === "ring") outerShape.holes.push(new THREE.Path(loopToShapePts(shape.inner)));
      const tex = theme.floorTex === "sand" ? sandTexture() : asphaltTexture();
      tex.repeat.set(1 / 150, 1 / 150);
      mapDisposables.push(tex);
      const floor = new THREE.Mesh(
        new THREE.ShapeGeometry(outerShape),
        new THREE.MeshStandardMaterial({ color: 0xffffff, map: tex, roughness: 0.95, metalness: 0.05 })
      );
      floor.rotation.x = -Math.PI / 2;
      floor.receiveShadow = true;
      mapGroup.add(floor);

      if (shape.kind === "ring") {
        // Grass infield island inside the ring.
        const island = new THREE.Mesh(
          new THREE.ShapeGeometry(new THREE.Shape(loopToShapePts(shape.inner))),
          new THREE.MeshStandardMaterial({ color: theme.island ?? 0x2c4a33, roughness: 1 })
        );
        island.rotation.x = -Math.PI / 2;
        island.position.y = -0.4;
        island.receiveShadow = true;
        mapGroup.add(island);
      }
    }

    // Continuous curved barrier along a boundary loop: armco-style rail with
    // posts + an emissive top tube ("rail"), or a rough rock rim ("rock").
    function buildBarrierLoop(loop, theme) {
      const pts = (y) => loop.map((p) => new THREE.Vector3(p.x, y, p.y));
      if (theme.barrier === "rock") {
        const rim = new THREE.Mesh(
          new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts(8), true), loop.length, 24, 8, true),
          new THREE.MeshStandardMaterial({ color: theme.wall, roughness: 1, flatShading: true })
        );
        rim.castShadow = true;
        rim.receiveShadow = true;
        mapGroup.add(rim);
        return;
      }
      const postMat = new THREE.MeshStandardMaterial({ color: 0x39424f, roughness: 0.6, metalness: 0.4 });
      const postGeo = new THREE.CylinderGeometry(4, 4, 30, 6);
      for (let i = 0; i < loop.length; i += 4) {
        const post = new THREE.Mesh(postGeo, postMat);
        post.position.set(loop[i].x, 15, loop[i].y);
        mapGroup.add(post);
      }
      const rail = new THREE.Mesh(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts(26), true), loop.length * 2, 7, 8, true),
        new THREE.MeshStandardMaterial({ color: theme.wall, roughness: 0.35, metalness: 0.7 })
      );
      rail.castShadow = true;
      mapGroup.add(rail);
      const neonTube = new THREE.Mesh(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts(38), true), loop.length * 2, 3.2, 6, true),
        new THREE.MeshStandardMaterial({ color: theme.neon, emissive: theme.neon, emissiveIntensity: 2.4 })
      );
      mapGroup.add(neonTube);
    }

    function buildStartLine(start) {
      const tex = checkerTexture();
      mapDisposables.push(tex);
      const g = new THREE.Group();
      const strip = new THREE.Mesh(
        new THREE.PlaneGeometry(226, 46),
        new THREE.MeshBasicMaterial({ map: tex })
      );
      strip.rotation.x = -Math.PI / 2;
      g.add(strip);
      g.position.set(start.x, 0.8, start.y);
      g.rotation.y = -(start.angle + Math.PI / 2); // strip spans ACROSS the track
      mapGroup.add(g);
    }

    // ── Shared scenery helpers ──
    function buildStars() {
      const rnd = mulberry32(97);
      const N = 700;
      const pos = new Float32Array(N * 3);
      const col = new Float32Array(N * 3);
      for (let i = 0; i < N; i++) {
        const a = rnd() * Math.PI * 2;
        const el = 0.08 + rnd() * 1.35;
        const r = 3200 + rnd() * 500;
        pos[i * 3] = dims.cx + Math.cos(a) * Math.cos(el) * r;
        pos[i * 3 + 1] = 150 + Math.sin(el) * r;
        pos[i * 3 + 2] = dims.cz + Math.sin(a) * Math.cos(el) * r;
        const b = 0.5 + rnd() * 0.5;
        col[i * 3] = b; col[i * 3 + 1] = b; col[i * 3 + 2] = Math.min(1, b + 0.12);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
      const stars = new THREE.Points(geo, new THREE.PointsMaterial({
        size: 5, vertexColors: true, sizeAttenuation: true, fog: false,
        transparent: true, opacity: 0.9, depthWrite: false,
      }));
      stars.frustumCulled = false;
      mapGroup.add(stars);
    }

    function buildMoon() {
      const moon = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTex, color: 0xf4f0e0, fog: false, depthWrite: false,
      }));
      moon.scale.set(300, 300, 1);
      moon.position.set(dims.cx - 900, 1500, dims.cz - 2100);
      mapGroup.add(moon);
    }

    function buildSunSprite(color, scale) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTex, color, fog: false, depthWrite: false,
      }));
      s.scale.set(scale, scale, 1);
      s.position.set(dims.cx + 1400, 1600, dims.cz - 1900);
      mapGroup.add(s);
    }

    function buildClouds(count, tint, opacity) {
      const rnd = mulberry32(67);
      const clouds = [];
      for (let i = 0; i < count; i++) {
        const c = new THREE.Sprite(new THREE.SpriteMaterial({
          map: glowTex, color: tint, transparent: true, opacity,
          fog: false, depthWrite: false,
        }));
        const sc = 420 + rnd() * 420;
        c.scale.set(sc, sc * 0.45, 1);
        c.position.set(dims.cx - 2400 + rnd() * 4800, 680 + rnd() * 260, dims.cz - 1400 - rnd() * 900);
        mapGroup.add(c);
        clouds.push(c);
      }
      mapFx.clouds = clouds;
    }

    function buildMountains(colorInt) {
      const rnd = mulberry32(89);
      const mtnMat = new THREE.MeshStandardMaterial({ color: colorInt, roughness: 1, flatShading: true });
      const base = Math.max(dims.w, dims.h) * 1.1 + 400;
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2 + rnd() * 0.2;
        const r = base + rnd() * 600;
        const hM = 380 + rnd() * 620;
        const m = new THREE.Mesh(new THREE.ConeGeometry(300 + rnd() * 420, hM, 5), mtnMat);
        m.position.set(dims.cx + Math.cos(a) * r, hM / 2 - 30, dims.cz + Math.sin(a) * r);
        m.rotation.y = rnd() * Math.PI;
        mapGroup.add(m);
      }
    }

    function buildFloodlights(spots) {
      // Emissive heads + additive light cones — bloom sells it at zero
      // real-light cost.
      const poleMat = new THREE.MeshStandardMaterial({ color: 0x1f2937 });
      const lampMat = new THREE.MeshStandardMaterial({ color: 0xfff7d6, emissive: 0xfff7d6, emissiveIntensity: 2.6 });
      const coneMat = new THREE.MeshBasicMaterial({
        color: 0xfff3c4, transparent: true, opacity: 0.07,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      });
      for (const [x, z] of spots) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(9, 11, 420, 8), poleMat);
        pole.position.set(x, 210, z);
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(84, 26, 34), lampMat);
        lamp.position.set(x, 430, z);
        lamp.lookAt(dims.cx, 0, dims.cz);
        const cone = new THREE.Mesh(new THREE.ConeGeometry(340, 760, 20, 1, true), coneMat);
        cone.position.set(x, 430, z);
        cone.lookAt(dims.cx, 0, dims.cz);
        cone.rotateX(-Math.PI / 2);
        cone.translateY(-380);
        mapGroup.add(pole, lamp, cone);
      }
    }

    function buildBillboards(spots, texts, y) {
      spots.forEach(([x, z], i) => {
        const tex = billboardTexture(texts[i % texts.length]);
        mapDisposables.push(tex);
        const panel = new THREE.Mesh(
          new THREE.PlaneGeometry(340, 84),
          new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, side: THREE.DoubleSide })
        );
        panel.position.set(x, y, z);
        panel.lookAt(dims.cx, y, dims.cz);
        mapGroup.add(panel);
      });
    }

    // One ambient particle system per map: rising embers, falling leaves, or
    // drifting dust motes.
    function buildMotes({ color, size, count, mode, additive = false, opacity = 0.9, map = null }) {
      const pos = new Float32Array(count * 3);
      const vel = [];
      for (let i = 0; i < count; i++) {
        pos[i * 3] = -200 + Math.random() * (dims.w + 400);
        pos[i * 3 + 1] = Math.random() * (mode === "fall" ? 460 : 520);
        pos[i * 3 + 2] = -200 + Math.random() * (dims.h + 400);
        vel.push(mode === "drift" ? 20 + Math.random() * 30 : mode === "fall" ? 16 + Math.random() * 26 : 28 + Math.random() * 60);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      const opts = {
        color, size, transparent: true, opacity, depthWrite: false, sizeAttenuation: true,
      };
      if (map) { opts.map = map; opts.alphaTest = 0.1; }
      if (additive) opts.blending = THREE.AdditiveBlending;
      const points = new THREE.Points(geo, new THREE.PointsMaterial(opts));
      points.frustumCulled = false;
      mapGroup.add(points);
      mapFx.motes = { points, pos, vel, n: count, mode, additive };
    }

    // ── Background scenes ──
    function buildStand(cx, cz, len, axis, facing, crowdTex) {
      const standMat = new THREE.MeshStandardMaterial({ color: 0x2b3648, roughness: 0.9 });
      const box = new THREE.Mesh(
        axis === "x" ? new THREE.BoxGeometry(len, 120, 120) : new THREE.BoxGeometry(120, 120, len),
        standMat
      );
      box.position.set(cx, 60, cz);
      mapGroup.add(box);

      // Crowd plane sits on the stand's field-facing edge; lookAt aims it at
      // the field center with a natural downward tilt, whatever the side.
      const crowd = new THREE.Mesh(
        new THREE.PlaneGeometry(len, 130),
        new THREE.MeshBasicMaterial({ map: crowdTex })
      );
      crowd.position.set(
        axis === "x" ? cx : cx + facing * 62,
        130,
        axis === "x" ? cz + facing * 62 : cz
      );
      crowd.lookAt(dims.cx, 20, dims.cz);
      mapGroup.add(crowd);
    }

    function buildStadium() {
      const crowdTex = crowdTexture();
      crowdTex.repeat.set(10, 2);
      mapDisposables.push(crowdTex);

      buildStand(dims.cx, -260, dims.w + 400, "x", 1, crowdTex);
      buildStand(dims.cx, dims.h + 260, dims.w + 400, "x", -1, crowdTex);
      buildStand(-260, dims.cz, dims.h + 400, "z", 1, crowdTex);
      buildStand(dims.w + 260, dims.cz, dims.h + 400, "z", -1, crowdTex);

      buildBillboards(
        [[dims.cx, -235], [dims.cx, dims.h + 235], [-235, dims.cz], [dims.w + 235, dims.cz]],
        ["GROOT GP", "SMASH!", "TURBO", "GROOT ARENA"],
        210
      );
      buildFloodlights([
        [-220, -220], [dims.w + 220, -220], [-220, dims.h + 220], [dims.w + 220, dims.h + 220],
      ]);

      // Crowd camera flashes.
      const flashes = [];
      const rnd = mulberry32(53);
      for (let i = 0; i < 26; i++) {
        const side = Math.floor(rnd() * 4);
        const along = rnd();
        let x, z;
        if (side === 0) { x = -100 + along * (dims.w + 200); z = -250; }
        else if (side === 1) { x = -100 + along * (dims.w + 200); z = dims.h + 250; }
        else if (side === 2) { x = -250; z = -100 + along * (dims.h + 200); }
        else { x = dims.w + 250; z = -100 + along * (dims.h + 200); }
        const s = new THREE.Sprite(new THREE.SpriteMaterial({
          map: glowTex, color: 0xffffff, transparent: true, opacity: 0,
          blending: THREE.AdditiveBlending, depthWrite: false,
        }));
        s.scale.set(26, 26, 1);
        s.position.set(x, 90 + rnd() * 80, z);
        mapGroup.add(s);
        flashes.push(s);
      }
      mapFx.flashes = flashes;
    }

    function buildForest() {
      const rnd = mulberry32(71);
      const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a3d24, roughness: 1 });
      const leafMats = [0x2f7d3a, 0x3f9147, 0x66a832].map(
        (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 1 })
      );

      const placeRing = (count, rMin, rMax, place) => {
        for (let i = 0; i < count; i++) {
          const a = (i / count) * Math.PI * 2 + rnd() * 0.3;
          const r = rMin + rnd() * (rMax - rMin);
          const x = dims.cx + Math.cos(a) * r;
          const z = dims.cz + Math.sin(a) * r * 0.8;
          // Keep decor strictly outside the arena walls.
          if (x > -60 && x < dims.w + 60 && z > -60 && z < dims.h + 60) continue;
          place(x, z);
        }
      };

      const tree = (x, z) => {
        const conifer = rnd() > 0.45;
        const s = 0.8 + rnd() * 0.7;
        if (conifer) {
          const trunk = new THREE.Mesh(new THREE.CylinderGeometry(9 * s, 13 * s, 55 * s, 7), trunkMat);
          trunk.position.set(x, 27 * s, z);
          mapGroup.add(trunk);
          const lm = leafMats[Math.floor(rnd() * leafMats.length)];
          for (let t = 0; t < 3; t++) {
            const cone = new THREE.Mesh(new THREE.ConeGeometry((52 - t * 13) * s, 70 * s, 8), lm);
            cone.position.set(x, (70 + t * 42) * s, z);
            cone.castShadow = t === 0;
            mapGroup.add(cone);
          }
        } else {
          const trunk = new THREE.Mesh(new THREE.CylinderGeometry(10 * s, 14 * s, 70 * s, 7), trunkMat);
          trunk.position.set(x, 35 * s, z);
          mapGroup.add(trunk);
          const lm = leafMats[Math.floor(rnd() * leafMats.length)];
          const crown = new THREE.Mesh(new THREE.SphereGeometry(48 * s, 9, 8), lm);
          crown.position.set(x, 105 * s, z);
          crown.castShadow = true;
          mapGroup.add(crown);
          const side = new THREE.Mesh(new THREE.SphereGeometry(30 * s, 8, 7), lm);
          side.position.set(x + 30 * s, 82 * s, z + 12 * s);
          mapGroup.add(side);
        }
      };
      placeRing(26, 820, 1000, tree);
      placeRing(16, 1120, 1380, tree);

      const bushMat = new THREE.MeshStandardMaterial({ color: 0x2c6b35, roughness: 1 });
      placeRing(20, 780, 820, (x, z) => {
        const b = new THREE.Mesh(new THREE.SphereGeometry(16 + rnd() * 14, 8, 6), bushMat);
        b.position.set(x, 12, z);
        b.scale.y = 0.7;
        mapGroup.add(b);
      });

      buildMountains(0x51707f);
      buildSunSprite(0xfff0b0, 520);
      buildClouds(7, 0xffffff, 0.45);
    }

    function buildVolcano() {
      const rnd = mulberry32(83);
      const VX = dims.cx, VZ = -1150;

      const rockMat = new THREE.MeshStandardMaterial({ color: 0x241d22, roughness: 1, flatShading: true });
      const cone = new THREE.Mesh(new THREE.CylinderGeometry(150, 780, 620, 24, 3), rockMat);
      cone.position.set(VX, 310, VZ);
      mapGroup.add(cone);

      const craterMat = new THREE.MeshBasicMaterial({ color: 0xff5a1f, toneMapped: false });
      const crater = new THREE.Mesh(new THREE.CircleGeometry(132, 24), craterMat);
      crater.rotation.x = -Math.PI / 2;
      crater.position.set(VX, 622, VZ);
      mapGroup.add(crater);
      mapFx.lavaMats = [craterMat];

      const streakMat = new THREE.MeshBasicMaterial({ color: 0xff4a1a, toneMapped: false });
      for (const a of [0.5, 1.8, 3.4, 5.0]) {
        const streak = new THREE.Mesh(new THREE.BoxGeometry(11, 300, 11), streakMat);
        streak.position.set(VX + Math.cos(a) * 430, 340, VZ + Math.sin(a) * 430);
        streak.lookAt(VX, 760, VZ);
        streak.rotateX(Math.PI / 2);
        mapGroup.add(streak);
      }

      // Smoke plume looping out of the crater.
      const smoke = [];
      for (let i = 0; i < 12; i++) {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({
          map: glowTex, color: 0x554a48, transparent: true, opacity: 0.4,
          depthWrite: false, fog: false,
        }));
        s.position.set(VX + (rnd() - 0.5) * 80, 640 + (i / 12) * 420, VZ + (rnd() - 0.5) * 80);
        s.userData.vy = 46 + rnd() * 40;
        mapGroup.add(s);
        smoke.push(s);
      }
      mapFx.smoke = { sprites: smoke, baseY: 640, vx: VX, vz: VZ };

      // Lava pools bubbling outside the walls.
      const pools = [];
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + rnd() * 0.5;
        const r = 950 + rnd() * 320;
        const x = dims.cx + Math.cos(a) * r;
        const z = dims.cz + Math.sin(a) * r * 0.8;
        if (x > -60 && x < dims.w + 60 && z > -60 && z < dims.h + 60) continue;
        const mat = new THREE.MeshBasicMaterial({ color: 0xff5a1f, transparent: true, opacity: 0.9, toneMapped: false });
        const pool = new THREE.Mesh(new THREE.CircleGeometry(60 + rnd() * 80, 18), mat);
        pool.rotation.x = -Math.PI / 2;
        pool.position.set(x, 0.4, z);
        mapGroup.add(pool);
        pools.push(mat);
      }
      mapFx.lavaMats.push(...pools);

      // Basalt column clusters.
      const colMat = new THREE.MeshStandardMaterial({ color: 0x2a2530, roughness: 0.9 });
      for (const a of [0.8, 2.4, 4.0, 5.5]) {
        const cxp = dims.cx + Math.cos(a) * 1050;
        const czp = dims.cz + Math.sin(a) * 850;
        for (let i = 0; i < 6; i++) {
          const hgt = 50 + rnd() * 120;
          const col = new THREE.Mesh(new THREE.CylinderGeometry(24, 27, hgt, 6), colMat);
          col.position.set(cxp + (rnd() - 0.5) * 160, hgt / 2, czp + (rnd() - 0.5) * 160);
          col.rotation.y = rnd() * Math.PI;
          mapGroup.add(col);
        }
      }
    }

    function buildCircuitDeco() {
      buildMountains(0x3a2c4a);
      buildClouds(6, 0xd8a8c0, 0.35);
      buildFloodlights([
        [dims.cx - 1150, dims.cz - 780], [dims.cx + 1150, dims.cz - 780],
        [dims.cx - 1150, dims.cz + 780], [dims.cx + 1150, dims.cz + 780],
      ]);
      // Billboard posts around the outside of the track.
      const texts = ["GROOT GP", "TURBO", "LAP KING", "SMASH!"];
      const spots = [0.45, 2.0, 3.6, 5.2].map((a) => [
        dims.cx + Math.cos(a) * 1000,
        dims.cz + Math.sin(a) * 760,
      ]);
      const poleMat = new THREE.MeshStandardMaterial({ color: 0x39424f, roughness: 0.7 });
      for (const [x, z] of spots) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 120, 8), poleMat);
        pole.position.set(x, 60, z);
        mapGroup.add(pole);
      }
      buildBillboards(spots, texts, 150);
    }

    function buildCanyonDeco() {
      const rnd = mulberry32(59);
      const sandstone = [0xb98a5e, 0xa87850, 0x8f6644].map(
        (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 1, flatShading: true })
      );
      // Mesas — stacked truncated cones outside the boundary blob.
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2 + rnd() * 0.4;
        const r = 1000 + rnd() * 550;
        const x = dims.cx + Math.cos(a) * r;
        const z = dims.cz + Math.sin(a) * r * 0.8;
        // Skip anything that would land inside the arena bowl.
        if (Math.hypot(x - dims.cx, (z - dims.cz) / 0.75) < 820) continue;
        let y = 0;
        let rad = 90 + rnd() * 110;
        const tiers = 2 + Math.floor(rnd() * 2);
        for (let tier = 0; tier < tiers; tier++) {
          const hgt = 60 + rnd() * 90;
          const m = new THREE.Mesh(
            new THREE.CylinderGeometry(rad * 0.82, rad, hgt, 9),
            sandstone[Math.floor(rnd() * sandstone.length)]
          );
          m.position.set(x, y + hgt / 2, z);
          mapGroup.add(m);
          y += hgt;
          rad *= 0.72;
        }
      }
      // Scattered desert rocks.
      const rockMat = new THREE.MeshStandardMaterial({ color: 0x9a7a56, roughness: 1, flatShading: true });
      for (let i = 0; i < 12; i++) {
        const a = rnd() * Math.PI * 2;
        const r = 880 + rnd() * 500;
        const x = dims.cx + Math.cos(a) * r;
        const z = dims.cz + Math.sin(a) * r * 0.8;
        if (Math.hypot(x - dims.cx, (z - dims.cz) / 0.75) < 820) continue;
        const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(14 + rnd() * 26, 0), rockMat);
        rock.position.set(x, 10, z);
        rock.scale.y = 0.7;
        mapGroup.add(rock);
      }
      buildMountains(0x8a5a40);
      buildSunSprite(0xffe8c0, 600);
      buildClouds(5, 0xfff0d8, 0.4);
    }

    function buildMap(mapId) {
      disposeGroup(mapGroup);
      // Pickup meshes are positioned per map — rebuild them with it.
      for (const pm of pickupMeshes.values()) {
        scene.remove(pm.mesh, pm.light, pm.tag);
        pm.mesh.geometry.dispose();
        pm.mesh.material.dispose();
      }
      pickupMeshes.clear();

      const map = getMap(mapId);
      const theme = map.theme;
      curTheme = theme;
      dims.w = map.w || ARENA_W;
      dims.h = map.h || ARENA_H;
      dims.cx = dims.w / 2;
      dims.cz = dims.h / 2;

      if (scene.background?.dispose) scene.background.dispose();
      scene.background = gradientTexture(theme.sky);
      scene.fog.color.setHex(theme.fog);
      scene.fog.far = theme.fogFar ?? 3400;
      renderer.toneMappingExposure = theme.exposure ?? 1.15;
      bloomPass.strength = theme.bloom ?? 0.55;

      sun.color.setHex(theme.sun.color);
      sun.intensity = theme.sun.intensity;
      sun.position.set(dims.w * 0.35, 1500, dims.h * 0.15);
      sun.target.position.set(dims.cx, 0, dims.cz);
      const half = Math.max(dims.w, dims.h) * 0.72 + 240;
      sun.shadow.camera.left = -half;
      sun.shadow.camera.right = half;
      sun.shadow.camera.top = half;
      sun.shadow.camera.bottom = -half;
      sun.shadow.camera.updateProjectionMatrix();
      hemi.color.setHex(theme.hemi.sky);
      hemi.groundColor.setHex(theme.hemi.ground);
      hemi.intensity = theme.hemi.intensity;

      // A huge outer ground so the world doesn't float in a void.
      const outer = new THREE.Mesh(
        new THREE.PlaneGeometry(9000, 9000),
        new THREE.MeshStandardMaterial({ color: theme.outer, roughness: 1 })
      );
      outer.rotation.x = -Math.PI / 2;
      outer.position.set(dims.cx, -2, dims.cz);
      mapGroup.add(outer);

      if (map.shape) {
        // Curvy arena: ribbon/blob floor + continuous curved barriers.
        buildShapedFloor(map.shape, theme);
        buildBarrierLoop(map.shape.outer, theme);
        if (map.shape.inner) buildBarrierLoop(map.shape.inner, theme);
        if (map.shape.start) buildStartLine(map.shape.start);
      } else {
        // Rectangular arena: textured floor + boxed walls with neon trim.
        let floorMat;
        if (theme.floorTex === "basalt") {
          const { map: alb, emissiveMap } = basaltTextures();
          alb.repeat.set(5, 3);
          emissiveMap.repeat.set(5, 3);
          mapDisposables.push(alb, emissiveMap);
          floorMat = new THREE.MeshStandardMaterial({
            color: 0xffffff, map: alb, roughness: 0.95,
            emissive: 0xff5a1f, emissiveMap, emissiveIntensity: 0.9,
          });
          mapFx.floorMat = floorMat;
        } else {
          const tex = theme.floorTex === "grass" ? grassTexture() : asphaltTexture();
          tex.repeat.set(5.3, 3);
          mapDisposables.push(tex);
          floorMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: tex, roughness: 0.95, metalness: 0.05 });
        }
        const floor = new THREE.Mesh(new THREE.PlaneGeometry(dims.w, dims.h), floorMat);
        floor.rotation.x = -Math.PI / 2;
        floor.position.set(dims.cx, 0, dims.cz);
        floor.receiveShadow = true;
        mapGroup.add(floor);

        if (theme.grid) {
          const grid = new THREE.GridHelper(Math.max(dims.w, dims.h), 32, theme.neon, 0x243350);
          grid.position.set(dims.cx, 0.6, dims.cz);
          grid.material.opacity = 0.3;
          grid.material.transparent = true;
          mapGroup.add(grid);
        }
        if (theme.centerRing !== false) {
          const ring = new THREE.Mesh(
            new THREE.RingGeometry(120, 132, 48),
            new THREE.MeshBasicMaterial({ color: theme.neon, side: THREE.DoubleSide, transparent: true, opacity: 0.4 })
          );
          ring.rotation.x = -Math.PI / 2;
          ring.position.set(dims.cx, 1, dims.cz);
          mapGroup.add(ring);
        }

        const wallMat = new THREE.MeshStandardMaterial({ color: theme.wall, roughness: 0.7, metalness: 0.2 });
        const neonMat = new THREE.MeshStandardMaterial({ color: theme.neon, emissive: theme.neon, emissiveIntensity: 2.2 });
        const WALL_H = 50, WALL_T = 16;
        const walls = [
          [dims.cx, WALL_H / 2, 0, dims.w, WALL_H, WALL_T],
          [dims.cx, WALL_H / 2, dims.h, dims.w, WALL_H, WALL_T],
          [0, WALL_H / 2, dims.cz, WALL_T, WALL_H, dims.h],
          [dims.w, WALL_H / 2, dims.cz, WALL_T, WALL_H, dims.h],
        ];
        for (const [x, y, z, sx, sy, sz] of walls) {
          const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), wallMat);
          m.position.set(x, y, z);
          m.castShadow = true;
          m.receiveShadow = true;
          mapGroup.add(m);
          const strip = new THREE.Mesh(new THREE.BoxGeometry(sx, 3, sz), neonMat);
          strip.position.set(x, WALL_H + 1, z);
          mapGroup.add(strip);
        }
      }

      // Discrete obstacles (barrier capsules are drawn as curved rails above).
      for (const o of map.obstacles) {
        if (o.kind === "barrier") continue;
        if (o.kind === "tyre") mapGroup.add(buildCircle(o, theme));
        else mapGroup.add(buildLog(o, theme));
      }

      if (theme.stars) buildStars();
      if (theme.moon) buildMoon();

      if (theme.deco === "stadium") buildStadium();
      else if (theme.deco === "forest") buildForest();
      else if (theme.deco === "volcano") buildVolcano();
      else if (theme.deco === "circuit") buildCircuitDeco();
      else if (theme.deco === "canyon") buildCanyonDeco();

      if (theme.ambient === "embers") buildMotes({ color: 0xff7a33, size: 7, count: 150, mode: "rise", additive: true, opacity: 0.85 });
      else if (theme.ambient === "leaves") buildMotes({ map: leafTex, color: 0xffffff, size: 15, count: 80, mode: "fall" });
      else if (theme.ambient === "dust") buildMotes({ color: 0xd8c2a0, size: 9, count: 110, mode: "drift", additive: true, opacity: 0.35 });

      builtMapId = mapId;
    }

    // ── Reusable kart model ──
    const sharedWheelGeo = new THREE.CylinderGeometry(9, 9, 8, 18);
    const sharedHubGeo = new THREE.CylinderGeometry(4.5, 4.5, 8.6, 12);
    function makeKart(colorInt) {
      const g = new THREE.Group();
      const chassis = new THREE.Group(); // everything that leans in corners
      g.add(chassis);

      const bodyMat = new THREE.MeshStandardMaterial({ color: colorInt, roughness: 0.28, metalness: 0.6 });
      bodyMat.emissive = new THREE.Color(0xffffff);
      bodyMat.emissiveIntensity = 0;
      const darkMat = new THREE.MeshStandardMaterial({ color: 0x1a2030, roughness: 0.6, metalness: 0.3 });

      const body = new THREE.Mesh(new THREE.BoxGeometry(52, 14, 30), bodyMat);
      body.position.y = 13; body.castShadow = true; chassis.add(body);
      const hood = new THREE.Mesh(new THREE.BoxGeometry(20, 8, 26), bodyMat);
      hood.position.set(26, 15, 0); hood.rotation.z = -0.16; hood.castShadow = true; chassis.add(hood);
      const nose = new THREE.Mesh(new THREE.BoxGeometry(14, 9, 22), bodyMat);
      nose.position.set(34, 11, 0); nose.castShadow = true; chassis.add(nose);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(48, 1.6, 8),
        new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.4 }));
      stripe.position.set(0, 20.6, 0); chassis.add(stripe);
      for (const side of [-1, 1]) {
        const skirt = new THREE.Mesh(new THREE.BoxGeometry(26, 6, 4), darkMat);
        skirt.position.set(0, 8, side * 16);
        chassis.add(skirt);
      }
      const spoiler = new THREE.Mesh(new THREE.BoxGeometry(5, 13, 30), bodyMat);
      spoiler.position.set(-27, 22, 0); spoiler.castShadow = true; chassis.add(spoiler);
      const spoilerTop = new THREE.Mesh(new THREE.BoxGeometry(14, 3, 34), bodyMat);
      spoilerTop.position.set(-27, 29, 0); chassis.add(spoilerTop);

      const cabin = new THREE.Mesh(new THREE.BoxGeometry(18, 12, 22),
        new THREE.MeshStandardMaterial({ color: 0x0b1220, roughness: 0.15, metalness: 0.4 }));
      cabin.position.set(-3, 24, 0); cabin.castShadow = true; chassis.add(cabin);
      const helmet = new THREE.Mesh(new THREE.SphereGeometry(6.4, 14, 14),
        new THREE.MeshStandardMaterial({ color: colorInt, roughness: 0.25, metalness: 0.35 }));
      helmet.position.set(-3, 33, 0); helmet.castShadow = true; chassis.add(helmet);
      const visor = new THREE.Mesh(new THREE.BoxGeometry(3, 3.6, 8),
        new THREE.MeshStandardMaterial({ color: 0x0b1220, roughness: 0.1, metalness: 0.6 }));
      visor.position.set(2.6, 33, 0); chassis.add(visor);

      const cannon = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.8, 24, 10),
        new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.7, roughness: 0.25 }));
      cannon.rotation.z = Math.PI / 2; cannon.position.set(32, 15, 0); chassis.add(cannon);
      for (const side of [-1, 1]) {
        const pipe = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 10, 8), darkMat);
        pipe.rotation.z = Math.PI / 2; pipe.position.set(-30, 10, side * 8);
        chassis.add(pipe);
      }

      // Head/tail lights (lens brightness retuned by night themes each frame).
      const lampMats = [];
      for (const side of [-1, 1]) {
        const lampMat = new THREE.MeshStandardMaterial({ color: 0xfff2c0, emissive: 0xfff2c0, emissiveIntensity: 0.5 });
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(2.6, 4, 6), lampMat);
        lamp.position.set(37, 12, side * 8);
        chassis.add(lamp);
        lampMats.push(lampMat);
        const tail = new THREE.Mesh(new THREE.BoxGeometry(2, 3, 7),
          new THREE.MeshStandardMaterial({ color: 0xff3344, emissive: 0xff2233, emissiveIntensity: 1.4 }));
        tail.position.set(-30.4, 14, side * 10);
        chassis.add(tail);
      }

      // Wheels — front pair sits in pivot groups so it can visibly steer;
      // all four spin with road speed.
      const wheelMat = new THREE.MeshStandardMaterial({ color: 0x0d1018, roughness: 0.85 });
      const hubMat = new THREE.MeshStandardMaterial({ color: 0x8a94a8, metalness: 0.7, roughness: 0.3 });
      const wheels = [];
      const frontPivots = [];
      for (const [x, z] of [[-19, -17], [19, -17], [-19, 17], [19, 17]]) {
        const wh = new THREE.Mesh(sharedWheelGeo, wheelMat);
        wh.rotation.x = Math.PI / 2;
        wh.castShadow = true;
        const hub = new THREE.Mesh(sharedHubGeo, hubMat);
        wh.add(hub);
        wheels.push(wh);
        if (x > 0) {
          const pivot = new THREE.Group();
          pivot.position.set(x, 9, z);
          pivot.add(wh);
          chassis.add(pivot);
          frontPivots.push(pivot);
        } else {
          wh.position.set(x, 9, z);
          chassis.add(wh);
        }
      }

      // Powerup aura (recolored per active powerup).
      const aura = new THREE.Mesh(
        new THREE.TorusGeometry(32, 3.2, 10, 28),
        new THREE.MeshStandardMaterial({ color: 0xfacc15, emissive: 0xfacc15, emissiveIntensity: 1.6, transparent: true, opacity: 0.9 })
      );
      aura.rotation.x = Math.PI / 2; aura.position.y = 5; aura.visible = false; g.add(aura);

      // Shield bubble.
      const shield = new THREE.Mesh(
        new THREE.SphereGeometry(38, 16, 16),
        new THREE.MeshStandardMaterial({ color: 0x60a5fa, emissive: 0x3b82f6, emissiveIntensity: 0.4, transparent: true, opacity: 0.22 })
      );
      shield.position.y = 16; shield.visible = false; g.add(shield);

      // Team ring under the kart (TDM).
      const teamRing = new THREE.Mesh(
        new THREE.RingGeometry(26, 34, 24),
        new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0.8 })
      );
      teamRing.rotation.x = -Math.PI / 2; teamRing.position.y = 2; teamRing.visible = false; g.add(teamRing);

      return { group: g, chassis, bodyMat, lampMats, wheels, frontPivots, aura, shield, teamRing, spin: 0, steerVis: 0, dustAt: 0 };
    }

    function makeSprite(w2, h2, scaleX, scaleY, y) {
      const canvas = document.createElement("canvas");
      canvas.width = w2; canvas.height = h2;
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
      sprite.scale.set(scaleX, scaleY, 1);
      sprite.position.y = y;
      return { sprite, canvas, ctx: canvas.getContext("2d"), tex, key: "" };
    }
    function drawLabel(lbl, name, hp, isMe, teamColor) {
      const key = `${name}|${hp}|${isMe}|${teamColor}`;
      if (key === lbl.key) return;
      lbl.key = key;
      const { ctx, canvas, tex } = lbl;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.font = "bold 30px sans-serif";
      ctx.textAlign = "center";
      ctx.lineWidth = 5;
      ctx.strokeStyle = "rgba(0,0,0,0.6)";
      ctx.strokeText(name.slice(0, 12), 128, 30);
      ctx.fillStyle = isMe ? "#ffffff" : "#dbe4f0";
      ctx.fillText(name.slice(0, 12), 128, 30);
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(53, 44, 150, 14);
      ctx.fillStyle = hp > 40 ? "#22c55e" : "#ef4444";
      ctx.fillRect(53, 44, Math.max(0, (150 * hp) / 100), 14);
      if (teamColor) { ctx.fillStyle = teamColor; ctx.fillRect(40, 46, 10, 10); }
      tex.needsUpdate = true;
    }
    function drawBombTag(lbl, secs) {
      const key = `b${secs}`;
      if (key === lbl.key) return;
      lbl.key = key;
      const { ctx, canvas, tex } = lbl;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.font = "bold 40px sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = "#fca5a5";
      ctx.fillText(`💣 ${secs}`, 128, 44);
      tex.needsUpdate = true;
    }

    // ── Dynamic collections ──
    const karts = new Map();
    const pickupMeshes = new Map();

    // Bullets: bright core + additive halo → bloom turns them into tracers.
    const bulletPool = [];
    const bulletGeo = new THREE.SphereGeometry(8, 10, 10);
    const bulletMat = new THREE.MeshBasicMaterial({ color: 0xffe08a, toneMapped: false });
    function getBullet(i) {
      while (bulletPool.length <= i) {
        const b = new THREE.Mesh(bulletGeo, bulletMat);
        const halo = new THREE.Sprite(new THREE.SpriteMaterial({
          map: glowTex, color: 0xffb84d, transparent: true, opacity: 0.8,
          blending: THREE.AdditiveBlending, depthWrite: false,
        }));
        halo.scale.set(36, 36, 1);
        b.add(halo);
        b.visible = false; scene.add(b); bulletPool.push(b);
      }
      return bulletPool[i];
    }

    // Skid dust pool.
    const dustPool = [];
    function spawnDust(x, z, colorInt) {
      let d = dustPool.find((p) => p.life <= 0);
      if (!d) {
        if (dustPool.length >= 90) return;
        const s = new THREE.Sprite(new THREE.SpriteMaterial({
          map: glowTex, transparent: true, opacity: 0, depthWrite: false,
        }));
        scene.add(s);
        d = { s, life: 0, max: 0.6 };
        dustPool.push(d);
      }
      d.s.material.color.setHex(colorInt);
      d.s.position.set(x, 5, z);
      d.s.scale.set(16, 16, 1);
      d.life = d.max;
    }

    function makePickup(pad) {
      const meta = PICKUP_META[pad.type] || PICKUP_META.health;
      const geo = pad.type === "health" ? new THREE.BoxGeometry(28, 28, 28)
        : pad.type === "shield" ? new THREE.IcosahedronGeometry(20)
        : pad.type === "speed" ? new THREE.ConeGeometry(18, 34, 6)
        : pad.type === "bomb" ? new THREE.SphereGeometry(20, 16, 16)
        : new THREE.OctahedronGeometry(22);
      const mat = new THREE.MeshStandardMaterial({ color: meta.color, emissive: meta.color, emissiveIntensity: 0.9, roughness: 0.3, metalness: 0.3, transparent: true });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(pad.x, 38, pad.y);
      mesh.castShadow = true;
      scene.add(mesh);
      const light = new THREE.PointLight(meta.color, 0.8, 260);
      light.position.set(pad.x, 62, pad.y);
      scene.add(light);
      // Emoji tag above the pad.
      const tag = makeSprite(64, 64, 46, 46, 82);
      tag.ctx.font = "48px sans-serif";
      tag.ctx.textAlign = "center";
      tag.ctx.fillText(meta.emoji, 32, 48);
      tag.tex.needsUpdate = true;
      tag.sprite.position.set(pad.x, 82, pad.y);
      scene.add(tag.sprite);
      return { mesh, light, tag: tag.sprite };
    }

    // ── Explosions: particles + shockwave ring + flash + brief light ──
    const explosions = [];
    const exGeo = new THREE.SphereGeometry(5, 6, 6);
    const ringGeo = new THREE.RingGeometry(0.82, 1, 32);
    function spawnExplosion(x, z, colorInt, big) {
      const n = big ? 34 : 18;
      const parts = [];
      for (let i = 0; i < n; i++) {
        const mat = new THREE.MeshBasicMaterial({
          color: i % 3 === 0 ? colorInt : (i % 2 ? 0xffa533 : 0xffd166),
          transparent: true, blending: THREE.AdditiveBlending, toneMapped: false,
        });
        const m = new THREE.Mesh(exGeo, mat);
        m.position.set(x, 18, z);
        if (big) m.scale.set(1.8, 1.8, 1.8);
        scene.add(m);
        const a = Math.random() * Math.PI * 2;
        const sp = (big ? 220 : 120) + Math.random() * (big ? 340 : 260);
        parts.push({ mesh: m, vx: Math.cos(a) * sp, vy: (big ? 180 : 120) + Math.random() * 240, vz: Math.sin(a) * sp });
      }
      const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
        color: 0xffb84d, transparent: true, opacity: 0.9, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
      }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(x, 4, z);
      ring.scale.set(30, 30, 1);
      scene.add(ring);
      const flash = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTex, color: 0xfff1c4, transparent: true, opacity: 1,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      flash.scale.set(big ? 300 : 160, big ? 300 : 160, 1);
      flash.position.set(x, 30, z);
      scene.add(flash);
      const light = new THREE.PointLight(0xffa244, big ? 5 : 2.5, big ? 700 : 420, 1);
      light.position.set(x, 60, z);
      scene.add(light);
      explosions.push({ parts, ring, flash, light, ringMax: big ? 420 : 240, born: performance.now(), life: big ? 0.9 : 0.75 });
    }

    // ── Chase camera ──
    const camPos = new THREE.Vector3(dims.cx, 700, dims.h + 700);
    const camLook = new THREE.Vector3(dims.cx, 0, dims.cz);
    const tmp = new THREE.Vector3();

    let raf;
    let lastT = performance.now();
    const render = () => {
      const now = performance.now();
      const fdt = Math.min(0.05, (now - lastT) / 1000);
      lastT = now;

      const { prev, cur, at } = snapRef.current;
      if (cur) {
        if (cur.mapId && cur.mapId !== builtMapId) buildMap(cur.mapId);
        const tdm = cur.mode === "tdm";
        const night = !!curTheme?.night;
        const t = prev ? Math.min(1, (now - at) / SNAP_INTERVAL) : 1;
        const prevById = {};
        if (prev) for (const p of prev.players) prevById[p.id] = p;

        const seen = new Set();
        let myPos = null, myAngle = 0;
        for (const p of cur.players) {
          seen.add(p.id);
          let k = karts.get(p.id);
          if (!k) {
            k = makeKart(COLOR_INT[p.color] ?? 0x94a3b8);
            k.label = makeSprite(256, 72, 150, 42, 66);
            k.bombTag = makeSprite(256, 64, 120, 30, 96);
            k.group.add(k.label.sprite, k.bombTag.sprite);
            k.prevHp = p.hp; k.wasAlive = p.alive;
            scene.add(k.group);
            karts.set(p.id, k);
          }
          const q = prevById[p.id];
          const x = q ? q.x + (p.x - q.x) * t : p.x;
          const z = q ? q.y + (p.y - q.y) * t : p.y;
          const angle = q ? lerpAngle(q.angle, p.angle, t) : p.angle;
          k.group.position.set(x, 0, z);
          k.group.rotation.y = -angle;
          k.group.visible = p.alive;

          // Frame-to-frame dynamics for wheel spin, steer, lean, and dust.
          const dxF = x - (k.lastX ?? x);
          const dzF = z - (k.lastZ ?? z);
          const sSigned = (dxF * Math.cos(angle) + dzF * Math.sin(angle)) / Math.max(fdt, 1e-3);
          const dAng = angleDelta(k.lastAngle ?? angle, angle);
          k.lastX = x; k.lastZ = z; k.lastAngle = angle;

          k.spin += (sSigned / 9) * fdt;
          const steerTarget = clamp((dAng / Math.max(fdt, 1e-3)) / 4.1, -1, 1);
          k.steerVis += (steerTarget - k.steerVis) * Math.min(1, fdt * 10);
          for (const wh of k.wheels) wh.rotation.y = k.spin;
          for (const piv of k.frontPivots) piv.rotation.y = -k.steerVis * 0.4;
          k.chassis.rotation.x = k.steerVis * Math.min(1, Math.abs(sSigned) / 520) * 0.2;

          // Headlight lenses glow hard at night; my kart gets a real beam.
          for (const lm of k.lampMats) lm.emissiveIntensity = night ? 2.6 : 0.5;
          if (p.id === myId && !k.beam) {
            k.beam = new THREE.SpotLight(0xfff4d6, 0, 950, 0.5, 0.45, 0);
            k.beam.position.set(34, 20, 0);
            k.beamTarget = new THREE.Object3D();
            k.beamTarget.position.set(560, 0, 0);
            k.group.add(k.beam, k.beamTarget);
            k.beam.target = k.beamTarget;
          }
          if (k.beam) k.beam.intensity = night && p.alive ? 1.6 : 0;

          // Skid dust off the rear wheels when driving hard.
          if (p.alive && Math.abs(sSigned) > 150) {
            const drifting = Math.abs(k.steerVis) > 0.45 && Math.abs(sSigned) > 260;
            if ((drifting || Math.abs(sSigned) > 400) && now - k.dustAt > (drifting ? 34 : 75)) {
              k.dustAt = now;
              const bx = x - Math.cos(angle) * 24;
              const bz = z - Math.sin(angle) * 24;
              const px = -Math.sin(angle) * 12;
              const pz = Math.cos(angle) * 12;
              const dustColor = curTheme?.dust ?? 0x9aa3b2;
              spawnDust(bx + px, bz + pz, dustColor);
              spawnDust(bx - px, bz - pz, dustColor);
            }
          }

          // Hit flash / bomb glow on the body emissive.
          if (p.bomb > 0) {
            k.bodyMat.emissive.setHex(0xff2222);
            k.bodyMat.emissiveIntensity = 0.5 + 0.5 * Math.abs(Math.sin(now * 0.012));
          } else {
            k.bodyMat.emissive.setHex(0xffffff);
            if (p.hp < k.prevHp) k.bodyMat.emissiveIntensity = 0.9;
            if (k.bodyMat.emissiveIntensity > 0) k.bodyMat.emissiveIntensity = Math.max(0, k.bodyMat.emissiveIntensity - fdt * 3);
          }
          k.prevHp = p.hp;

          if (k.wasAlive && !p.alive) spawnExplosion(x, z, COLOR_INT[p.color] ?? 0xffa533, false);
          k.wasAlive = p.alive;

          // Aura color by powerup priority: bomb > speed > rapid.
          let auraHex = null;
          if (p.bomb > 0) auraHex = 0xff3b30;
          else if (p.speed) auraHex = 0x22d3ee;
          else if (p.rapid) auraHex = 0xfacc15;
          k.aura.visible = p.alive && auraHex !== null;
          if (k.aura.visible) {
            k.aura.material.color.setHex(auraHex);
            k.aura.material.emissive.setHex(auraHex);
            k.aura.rotation.z += fdt * 4;
            k.aura.material.opacity = 0.6 + 0.3 * Math.sin(now * 0.01);
          }
          k.shield.visible = p.alive && p.shield;
          k.teamRing.visible = p.alive && tdm && !!p.team;
          if (k.teamRing.visible) k.teamRing.material.color.setHex(TEAM_INT[p.team] ?? 0xffffff);

          drawLabel(k.label, p.name, p.hp, p.id === myId, tdm ? TEAM_HEX[p.team] : null);
          k.bombTag.sprite.visible = p.alive && p.bomb > 0;
          if (k.bombTag.sprite.visible) drawBombTag(k.bombTag, Math.ceil(p.bomb / 1000));

          if (p.id === myId) { myPos = { x, z }; myAngle = angle; }
        }
        for (const [id, k] of karts) {
          if (!seen.has(id)) { scene.remove(k.group); karts.delete(id); }
        }

        // Bullets.
        const bullets = cur.bullets || [];
        for (let i = 0; i < bullets.length; i++) {
          const b = getBullet(i);
          b.position.set(bullets[i].x, 16, bullets[i].y);
          b.visible = true;
        }
        for (let i = bullets.length; i < bulletPool.length; i++) bulletPool[i].visible = false;

        // Pickups.
        for (const pad of cur.pickups || []) {
          let pm = pickupMeshes.get(pad.id);
          if (!pm) { pm = makePickup(pad); pickupMeshes.set(pad.id, pm); }
          pm.mesh.position.x = pad.x;
          pm.mesh.position.z = pad.y;
          pm.mesh.rotation.y = now * 0.002;
          pm.mesh.rotation.x = now * 0.0013;
          pm.mesh.position.y = 38 + Math.sin(now * 0.004 + pad.id) * 7;
          pm.mesh.material.opacity = pad.active ? 1 : 0.1;
          pm.mesh.material.emissiveIntensity = pad.active ? 0.9 : 0.08;
          pm.light.intensity = pad.active ? 0.8 : 0;
          pm.tag.visible = pad.active;
        }

        // Chase camera + speed FOV kick.
        if (myPos) {
          const fx = Math.cos(myAngle), fz = Math.sin(myAngle);
          tmp.set(myPos.x - fx * 330, 185, myPos.z - fz * 330);
          camPos.lerp(tmp, 0.12);
          camLook.lerp(tmp.set(myPos.x + fx * 165, 20, myPos.z + fz * 165), 0.2);
          camera.position.copy(camPos);
          camera.lookAt(camLook);
          const mc = cur.players.find((p) => p.id === myId);
          const mq = prevById[myId];
          let sp = 0;
          if (mc && mq) sp = Math.hypot(mc.x - mq.x, mc.y - mq.y) / (SNAP_INTERVAL / 1000);
          const fovTarget = 60 + Math.min(1, sp / 620) * 12;
          camera.fov += (fovTarget - camera.fov) * 0.08;
          camera.updateProjectionMatrix();
        }
      }

      // ── Ambient FX ──
      if (mapFx.motes) {
        const { points, pos, vel, n, mode, additive } = mapFx.motes;
        for (let i = 0; i < n; i++) {
          if (mode === "rise") {
            pos[i * 3 + 1] += vel[i] * fdt;
            pos[i * 3] += Math.sin(now * 0.001 + i) * 9 * fdt;
            if (pos[i * 3 + 1] > 540) {
              pos[i * 3 + 1] = 2;
              pos[i * 3] = -200 + Math.random() * (dims.w + 400);
              pos[i * 3 + 2] = -200 + Math.random() * (dims.h + 400);
            }
          } else if (mode === "fall") {
            pos[i * 3 + 1] -= vel[i] * fdt;
            pos[i * 3] += Math.sin(now * 0.0012 + i * 2.1) * 22 * fdt;
            if (pos[i * 3 + 1] < 2) pos[i * 3 + 1] = 460;
          } else {
            pos[i * 3] += vel[i] * fdt;
            pos[i * 3 + 1] += Math.sin(now * 0.0008 + i) * 6 * fdt;
            if (pos[i * 3] > dims.w + 250) pos[i * 3] = -250;
          }
        }
        points.geometry.attributes.position.needsUpdate = true;
        if (mode === "rise" && additive) points.material.opacity = 0.65 + 0.25 * Math.sin(now * 0.004);
      }
      if (mapFx.flashes) {
        for (const s of mapFx.flashes) {
          s.material.opacity = Math.max(0, s.material.opacity - fdt * 6);
          if (Math.random() < fdt * 0.06) s.material.opacity = 1;
        }
      }
      if (mapFx.clouds) {
        for (const c of mapFx.clouds) {
          c.position.x += 13 * fdt;
          if (c.position.x > dims.cx + 2600) c.position.x = dims.cx - 2600;
        }
      }
      if (mapFx.smoke) {
        const { sprites, baseY, vx, vz } = mapFx.smoke;
        for (const s of sprites) {
          s.position.y += s.userData.vy * fdt;
          const rise = s.position.y - baseY;
          const sc = 120 + rise * 0.55;
          s.scale.set(sc, sc, 1);
          s.material.opacity = Math.max(0, 0.42 * (1 - rise / 460));
          if (rise > 460) {
            s.position.set(vx + (Math.random() - 0.5) * 80, baseY, vz + (Math.random() - 0.5) * 80);
          }
        }
      }
      if (mapFx.lavaMats) {
        const pulse = 0.8 + 0.2 * Math.sin(now * 0.0022);
        for (let i = 0; i < mapFx.lavaMats.length; i++) {
          const m = mapFx.lavaMats[i];
          if (m.transparent) m.opacity = 0.7 + 0.3 * Math.sin(now * 0.002 + i * 1.7);
        }
        if (mapFx.floorMat) mapFx.floorMat.emissiveIntensity = 0.75 + 0.3 * pulse;
      }

      // Skid dust decay.
      for (const d of dustPool) {
        if (d.life <= 0) { d.s.material.opacity = 0; continue; }
        d.life -= fdt;
        const f = Math.max(0, d.life / d.max);
        d.s.material.opacity = f * 0.42;
        d.s.scale.x += 62 * fdt;
        d.s.scale.y += 62 * fdt;
        d.s.position.y += 18 * fdt;
      }

      // Drain bomb blasts.
      const booms = boomsRef?.current;
      if (booms) {
        for (const bm of booms) {
          if (!bm.consumed) { bm.consumed = true; spawnExplosion(bm.x, bm.y, 0xff3b30, true); }
        }
      }

      // Advance explosions.
      for (let e = explosions.length - 1; e >= 0; e--) {
        const ex = explosions[e];
        const age = (now - ex.born) / 1000;
        if (age > ex.life) {
          for (const part of ex.parts) { scene.remove(part.mesh); part.mesh.material.dispose(); }
          scene.remove(ex.ring, ex.flash, ex.light);
          ex.ring.material.dispose();
          ex.flash.material.dispose();
          explosions.splice(e, 1);
          continue;
        }
        const op = Math.max(0, 1 - age / ex.life);
        for (const part of ex.parts) {
          part.mesh.position.x += part.vx * fdt;
          part.mesh.position.y += part.vy * fdt;
          part.mesh.position.z += part.vz * fdt;
          part.vy -= 380 * fdt;
          part.mesh.material.opacity = op;
        }
        const rs = 30 + (ex.ringMax - 30) * Math.min(1, age / (ex.life * 0.7));
        ex.ring.scale.set(rs, rs, 1);
        ex.ring.material.opacity = op * 0.9;
        ex.flash.material.opacity = Math.max(0, 1 - age * 4.5);
        ex.light.intensity *= Math.max(0, 1 - fdt * 5);
      }

      composer.render();
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);

    // ── HUD refresh (5 Hz) ──
    const hudTimer = setInterval(() => {
      const cur = snapRef.current.cur;
      if (!cur) return;
      const board = [...cur.players].sort((a, b) => b.kills - a.kills).slice(0, 6);
      const me = cur.players.find((p) => p.id === myId) || null;
      const now = performance.now();
      const feed = (killFeedRef.current || []).filter((f) => now - f.at < 4500).slice(-4).reverse();
      setHud({ timeLeft: cur.timeLeft, board, me, feed, mode: cur.mode || "ffa", teamScores: cur.teamScores || null });
    }, 200);

    // ── Resize ──
    const onResize = () => {
      w = mount.clientWidth || w;
      h = mount.clientHeight || Math.round((w * ARENA_H) / ARENA_W);
      renderer.setSize(w, h);
      composer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(mount);

    return () => {
      cancelAnimationFrame(raf);
      clearInterval(hudTimer);
      ro.disconnect();
      composer.dispose();
      renderer.dispose();
      scene.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
      });
      for (const t of mapDisposables) t.dispose();
      glowTex.dispose();
      leafTex.dispose();
      if (scene.background?.dispose) scene.background.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
  }, [snapRef, killFeedRef, boomsRef, myId]);

  const tdm = hud.mode === "tdm";
  return (
    <div className="relative w-full mx-auto max-w-4xl" style={{ aspectRatio: `${ARENA_W} / ${ARENA_H}` }}>
      <div ref={mountRef} className="absolute inset-0 rounded-xl overflow-hidden border border-gray-800 bg-gray-950" />

      {/* Timer + (TDM) team scores */}
      <div className="absolute top-2 left-1/2 -translate-x-1/2 flex flex-col items-center">
        <div className="text-3xl font-bold text-white drop-shadow-lg tabular-nums">{fmtTime(hud.timeLeft)}</div>
        {tdm && hud.teamScores && (
          <div className="mt-1 flex items-center gap-3 text-lg font-bold bg-black/40 rounded-full px-3 py-0.5">
            <span style={{ color: TEAM_HEX.A }}>{hud.teamScores.A}</span>
            <span className="text-gray-400 text-sm">vs</span>
            <span style={{ color: TEAM_HEX.B }}>{hud.teamScores.B}</span>
          </div>
        )}
      </div>

      {/* Leaderboard */}
      <div className="absolute top-2 right-2 bg-black/45 rounded-lg px-3 py-2 text-sm space-y-0.5 min-w-[150px]">
        {hud.board.map((p) => (
          <div key={p.id} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5 truncate">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: tdm && p.team ? TEAM_HEX[p.team] : COLOR_HEX[p.color] }} />
              <span className={p.id === myId ? "text-white font-medium" : "text-gray-300"}>{p.name}</span>
            </span>
            <span className="text-gray-200 tabular-nums">{p.kills}</span>
          </div>
        ))}
      </div>

      {/* Kill feed */}
      <div className="absolute bottom-10 left-2 space-y-1 text-sm">
        {hud.feed.map((f, i) => (
          <div key={i} className="text-gray-200 bg-black/40 rounded px-2 py-0.5 w-fit">{f.text}</div>
        ))}
      </div>

      {/* Your HP */}
      {hud.me && (
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 w-56">
          <div className="h-3 rounded-full bg-black/50 overflow-hidden">
            <div className="h-full transition-all" style={{ width: `${Math.max(0, hud.me.hp)}%`, background: hud.me.hp > 40 ? "#22c55e" : "#ef4444" }} />
          </div>
        </div>
      )}

      {/* Respawn banner */}
      {hud.me && !hud.me.alive && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-red-400 text-3xl font-bold drop-shadow-lg">Wrecked! Respawning…</div>
        </div>
      )}
    </div>
  );
}
