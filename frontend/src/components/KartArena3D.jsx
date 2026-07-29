import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { getMap } from "@/games/kartMaps.js";

/**
 * The 3D renderer for Smash Karts. It owns NO game logic — it draws the world
 * snapshots the server streams (via `snapRef`) into a Three.js scene with a
 * chase camera behind the local player's kart. Server 2D (x, y) becomes the
 * ground plane (x, z); heading becomes yaw.
 *
 * Map-dependent geometry (floor/walls/obstacles/decor/theme) is (re)built from
 * the snapshot's `mapId`; everything else (renderer, camera, lights) is built
 * once. React is used only for the DOM HUD overlay, refreshed a few times/sec.
 */

const ARENA_W = 1600;
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

function gradientTexture(stops) {
  const c = document.createElement("canvas");
  c.width = 4;
  c.height = 256;
  const ctx = c.getContext("2d");
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, stops[0]);
  g.addColorStop(0.5, stops[1]);
  g.addColorStop(1, stops[2]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export default function KartArena3D({ snapRef, killFeedRef, boomsRef, myId }) {
  const mountRef = useRef(null);
  const [hud, setHud] = useState({ timeLeft: 0, board: [], me: null, feed: [], mode: "ffa", teamScores: null });

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    // ── Renderer ──
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

    const camera = new THREE.PerspectiveCamera(62, w / h, 1, 9000);
    camera.position.set(ARENA_W / 2, 700, ARENA_H + 700);
    camera.lookAt(ARENA_W / 2, 0, ARENA_H / 2);

    scene.add(new THREE.HemisphereLight(0xbcd4ff, 0x0c1524, 0.9));
    const sun = new THREE.DirectionalLight(0xffffff, 1.5);
    sun.position.set(ARENA_W * 0.35, 1500, ARENA_H * 0.15);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 200;
    sun.shadow.camera.far = 3600;
    sun.shadow.camera.left = -1100;
    sun.shadow.camera.right = 1100;
    sun.shadow.camera.top = 1100;
    sun.shadow.camera.bottom = -1100;
    sun.shadow.bias = -0.0005;
    sun.target.position.set(ARENA_W / 2, 0, ARENA_H / 2);
    scene.add(sun, sun.target);

    // ── Map-dependent geometry lives in one group we can rebuild ──
    const mapGroup = new THREE.Group();
    scene.add(mapGroup);
    let builtMapId = null;

    function disposeGroup(group) {
      group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
      });
      group.clear();
    }

    function buildLog(o, mat) {
      const dx = o.x2 - o.x1, dz = o.y2 - o.y1;
      const len = Math.hypot(dx, dz);
      const g = new THREE.Group();
      const cyl = new THREE.Mesh(new THREE.CylinderGeometry(o.r, o.r, len, 12), mat);
      cyl.rotation.z = Math.PI / 2; // lay along local X
      cyl.castShadow = true;
      g.add(cyl);
      g.position.set((o.x1 + o.x2) / 2, o.r, (o.y1 + o.y2) / 2);
      g.rotation.y = -Math.atan2(dz, dx);
      return g;
    }

    function buildTyre(o) {
      const g = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial({ color: 0x0d0f14, roughness: 0.95 });
      for (let i = 0; i < 2; i++) {
        const t = new THREE.Mesh(new THREE.TorusGeometry(o.r * 0.82, o.r * 0.34, 10, 20), mat);
        t.rotation.x = Math.PI / 2;
        t.position.y = o.r * 0.34 + i * o.r * 0.6;
        t.castShadow = true;
        g.add(t);
      }
      g.position.set(o.x, 0, o.y);
      return g;
    }

    function buildDeco(theme) {
      if (theme.deco === "forest") {
        const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a3d24, roughness: 1 });
        const leafMat = new THREE.MeshStandardMaterial({ color: 0x2f7d3a, roughness: 1 });
        const ring = [];
        for (let i = 0; i < 22; i++) {
          const a = (i / 22) * Math.PI * 2;
          const rad = 720 + (i % 3) * 90;
          ring.push([ARENA_W / 2 + Math.cos(a) * (rad + 300), ARENA_H / 2 + Math.sin(a) * (rad + 60)]);
        }
        for (const [x, z] of ring) {
          const s = 60 + (x % 40);
          const trunk = new THREE.Mesh(new THREE.CylinderGeometry(10, 14, s, 8), trunkMat);
          trunk.position.set(x, s / 2, z);
          const leaves = new THREE.Mesh(new THREE.ConeGeometry(46, 120, 9), leafMat);
          leaves.position.set(x, s + 55, z);
          mapGroup.add(trunk, leaves);
        }
      } else {
        // Stadium: grandstands on each side + light poles.
        const standMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.9 });
        const stands = [
          [ARENA_W / 2, 60, -260, ARENA_W + 400, 120, 120],
          [ARENA_W / 2, 60, ARENA_H + 260, ARENA_W + 400, 120, 120],
          [-260, 60, ARENA_H / 2, 120, 120, ARENA_H + 400],
          [ARENA_W + 260, 60, ARENA_H / 2, 120, 120, ARENA_H + 400],
        ];
        for (const [x, y, z, sx, sy, sz] of stands) {
          const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), standMat);
          m.position.set(x, y, z);
          mapGroup.add(m);
        }
        const poleMat = new THREE.MeshStandardMaterial({ color: 0x1f2937 });
        const lampMat = new THREE.MeshStandardMaterial({ color: 0xfff7d6, emissive: 0xfff7d6, emissiveIntensity: 1.2 });
        for (const [x, z] of [[-200, -200], [ARENA_W + 200, -200], [-200, ARENA_H + 200], [ARENA_W + 200, ARENA_H + 200]]) {
          const pole = new THREE.Mesh(new THREE.CylinderGeometry(8, 8, 320, 8), poleMat);
          pole.position.set(x, 160, z);
          const lamp = new THREE.Mesh(new THREE.BoxGeometry(70, 24, 30), lampMat);
          lamp.position.set(x, 330, z);
          mapGroup.add(pole, lamp);
        }
      }
    }

    function buildMap(mapId) {
      disposeGroup(mapGroup);
      const map = getMap(mapId);
      const theme = map.theme;

      if (scene.background?.dispose) scene.background.dispose();
      scene.background = gradientTexture(theme.sky);
      scene.fog.color.setHex(theme.fog);

      const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(ARENA_W, ARENA_H),
        new THREE.MeshStandardMaterial({ color: theme.floor, roughness: 0.95, metalness: 0.05 })
      );
      floor.rotation.x = -Math.PI / 2;
      floor.position.set(ARENA_W / 2, 0, ARENA_H / 2);
      floor.receiveShadow = true;
      mapGroup.add(floor);

      const grid = new THREE.GridHelper(Math.max(ARENA_W, ARENA_H), 32, theme.neon, 0x243350);
      grid.position.set(ARENA_W / 2, 0.6, ARENA_H / 2);
      grid.material.opacity = 0.35;
      grid.material.transparent = true;
      mapGroup.add(grid);

      const ring = new THREE.Mesh(
        new THREE.RingGeometry(120, 132, 48),
        new THREE.MeshBasicMaterial({ color: theme.neon, side: THREE.DoubleSide, transparent: true, opacity: 0.4 })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(ARENA_W / 2, 1, ARENA_H / 2);
      mapGroup.add(ring);

      const wallMat = new THREE.MeshStandardMaterial({ color: theme.wall, roughness: 0.7, metalness: 0.2 });
      const neonMat = new THREE.MeshStandardMaterial({ color: theme.neon, emissive: theme.neon, emissiveIntensity: 1.4 });
      const WALL_H = 50, WALL_T = 16;
      const walls = [
        [ARENA_W / 2, WALL_H / 2, 0, ARENA_W, WALL_H, WALL_T],
        [ARENA_W / 2, WALL_H / 2, ARENA_H, ARENA_W, WALL_H, WALL_T],
        [0, WALL_H / 2, ARENA_H / 2, WALL_T, WALL_H, ARENA_H],
        [ARENA_W, WALL_H / 2, ARENA_H / 2, WALL_T, WALL_H, ARENA_H],
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

      const logMat = new THREE.MeshStandardMaterial({ color: 0x6b4423, roughness: 0.9 });
      for (const o of map.obstacles) {
        if (o.kind === "tyre") mapGroup.add(buildTyre(o));
        else mapGroup.add(buildLog(o, logMat));
      }

      buildDeco(theme);
      builtMapId = mapId;
    }

    // ── Reusable kart model ──
    const sharedWheelGeo = new THREE.CylinderGeometry(8, 8, 7, 16);
    function makeKart(colorInt) {
      const g = new THREE.Group();
      const bodyMat = new THREE.MeshStandardMaterial({ color: colorInt, roughness: 0.32, metalness: 0.55 });
      bodyMat.emissive = new THREE.Color(0xffffff);
      bodyMat.emissiveIntensity = 0;

      const body = new THREE.Mesh(new THREE.BoxGeometry(52, 14, 30), bodyMat);
      body.position.y = 13; body.castShadow = true; g.add(body);
      const nose = new THREE.Mesh(new THREE.BoxGeometry(18, 10, 24), bodyMat);
      nose.position.set(30, 12, 0); nose.castShadow = true; g.add(nose);
      const spoiler = new THREE.Mesh(new THREE.BoxGeometry(6, 12, 30), bodyMat);
      spoiler.position.set(-27, 22, 0); spoiler.castShadow = true; g.add(spoiler);
      const spoilerTop = new THREE.Mesh(new THREE.BoxGeometry(14, 3, 32), bodyMat);
      spoilerTop.position.set(-27, 28, 0); g.add(spoilerTop);

      const cabin = new THREE.Mesh(new THREE.BoxGeometry(18, 12, 22), new THREE.MeshStandardMaterial({ color: 0x0b1220, roughness: 0.15, metalness: 0.4 }));
      cabin.position.set(-3, 24, 0); cabin.castShadow = true; g.add(cabin);
      const head = new THREE.Mesh(new THREE.SphereGeometry(6, 14, 14), new THREE.MeshStandardMaterial({ color: 0xf1c27d, roughness: 0.7 }));
      head.position.set(-3, 32, 0); head.castShadow = true; g.add(head);
      const cannon = new THREE.Mesh(new THREE.BoxGeometry(22, 6, 6), new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.7, roughness: 0.25 }));
      cannon.position.set(32, 14, 0); g.add(cannon);

      const wheelMat = new THREE.MeshStandardMaterial({ color: 0x0d1018, roughness: 0.85 });
      for (const [x, z] of [[-19, -17], [19, -17], [-19, 17], [19, 17]]) {
        const wh = new THREE.Mesh(sharedWheelGeo, wheelMat);
        wh.rotation.x = Math.PI / 2; wh.position.set(x, 8, z); wh.castShadow = true; g.add(wh);
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

      return { group: g, bodyMat, aura, shield, teamRing };
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
    const bulletPool = [];
    const bulletGeo = new THREE.SphereGeometry(8, 10, 10);
    const bulletMat = new THREE.MeshBasicMaterial({ color: 0xffe08a });
    function getBullet(i) {
      while (bulletPool.length <= i) {
        const b = new THREE.Mesh(bulletGeo, bulletMat);
        b.visible = false; scene.add(b); bulletPool.push(b);
      }
      return bulletPool[i];
    }

    function makePickup(pad) {
      const meta = PICKUP_META[pad.type] || PICKUP_META.health;
      const geo = pad.type === "health" ? new THREE.BoxGeometry(28, 28, 28)
        : pad.type === "shield" ? new THREE.IcosahedronGeometry(20)
        : pad.type === "speed" ? new THREE.ConeGeometry(18, 34, 6)
        : pad.type === "bomb" ? new THREE.SphereGeometry(20, 16, 16)
        : new THREE.OctahedronGeometry(22);
      const mat = new THREE.MeshStandardMaterial({ color: meta.color, emissive: meta.color, emissiveIntensity: 0.7, roughness: 0.3, metalness: 0.3, transparent: true });
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

    // ── Explosions ──
    const explosions = [];
    const exGeo = new THREE.SphereGeometry(5, 6, 6);
    function spawnExplosion(x, z, colorInt, big) {
      const n = big ? 34 : 18;
      const parts = [];
      for (let i = 0; i < n; i++) {
        const mat = new THREE.MeshBasicMaterial({
          color: i % 3 === 0 ? colorInt : (i % 2 ? 0xffa533 : 0xffd166),
          transparent: true, blending: THREE.AdditiveBlending,
        });
        const m = new THREE.Mesh(exGeo, mat);
        m.position.set(x, 18, z);
        if (big) m.scale.set(1.8, 1.8, 1.8);
        scene.add(m);
        const a = Math.random() * Math.PI * 2;
        const sp = (big ? 220 : 120) + Math.random() * (big ? 340 : 260);
        parts.push({ mesh: m, vx: Math.cos(a) * sp, vy: (big ? 180 : 120) + Math.random() * 240, vz: Math.sin(a) * sp });
      }
      explosions.push({ parts, born: performance.now(), life: big ? 0.9 : 0.75 });
    }

    // ── Chase camera ──
    const camPos = new THREE.Vector3(ARENA_W / 2, 700, ARENA_H + 700);
    const camLook = new THREE.Vector3(ARENA_W / 2, 0, ARENA_H / 2);
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
          pm.mesh.rotation.y = now * 0.002;
          pm.mesh.rotation.x = now * 0.0013;
          pm.mesh.position.y = 38 + Math.sin(now * 0.004 + pad.id) * 7;
          pm.mesh.material.opacity = pad.active ? 1 : 0.1;
          pm.mesh.material.emissiveIntensity = pad.active ? 0.7 : 0.08;
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
      }

      renderer.render(scene, camera);
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
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(mount);

    return () => {
      cancelAnimationFrame(raf);
      clearInterval(hudTimer);
      ro.disconnect();
      renderer.dispose();
      scene.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
      });
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
