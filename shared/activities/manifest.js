/**
 * The Activity Plugin manifest contract.
 *
 * A manifest is DATA — no imports, no components, no handlers. It answers
 * "what is this plugin, what may it do, how can it be configured?" and nothing
 * else. The registry holds manifests; the runtime loads implementations
 * separately and lazily (Excalidraw alone is ~1.8 MB, so eagerly importing
 * plugin code would be a serious bundle regression).
 *
 * validateManifest() throws. That is deliberate: it runs at registration, i.e.
 * at server boot and at bundle init, so a malformed plugin is a loud startup
 * crash with a precise message — not a blank tab for one unlucky user at 2am.
 */
import { validateConfigSchema } from "./config-schema.js";

/**
 * Capabilities a plugin may request. The SDK is BUILT from this list, so an
 * undeclared capability is `undefined` on the sdk object rather than a
 * permission check that fails at call time. Absent beats denied: the mistake
 * surfaces as a TypeError at the plugin's own call site during development,
 * instead of in production inside somebody else's stack frame.
 *
 * v1 is deliberately five capabilities. The plugins in scope (whiteboard +
 * games) need exactly these; chat/video/AI are NOT here because nothing in
 * scope needs them. Adding a capability later breaks nothing — that is the
 * whole reason the SDK is assembled from a declared list.
 */
export const CAPABILITIES = Object.freeze({
  "room:read": "Read room id, name, members and ownership",
  "socket:namespaced": "Send/receive realtime events under activity:<id>:*",
  "storage:room": "Persist this plugin's state for this room",
  "presence:read": "See who is currently in the room",
  "events:listen": "Subscribe to other plugins' bus events",
});

// `events` and `lifecycle` are always granted — a plugin that cannot announce
// itself or clean itself up is not a plugin. They are not requestable.
export const IMPLICIT_CAPABILITIES = Object.freeze(["events:emit", "lifecycle"]);

// Where a plugin renders. Drives which tab it appears under; the runtime uses
// it instead of a hand-maintained id→tab map (today's ACT_VIEW in RoomPage).
export const SURFACES = Object.freeze(["board", "game", "tab", "overlay", "headless"]);

export const CATEGORIES = Object.freeze(["games", "creativity", "productivity", "learning", "media"]);

// Lowercase kebab: it appears in socket event names (activity:draw-guess:move),
// URLs and storage keys, so anything exotic would need escaping everywhere.
const ID_RE = /^[a-z][a-z0-9-]{1,31}$/;
const SEMVER_RE = /^\d+\.\d+\.\d+$/;

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * Throws on any malformed manifest. Every message names the plugin and field,
 * because the person reading it is usually adding their first plugin.
 */
export function validateManifest(m) {
  if (!isPlainObject(m)) throw new Error("Manifest must be an object");

  const id = m.id;
  if (typeof id !== "string" || !ID_RE.test(id)) {
    throw new Error(`Manifest id "${id}" must be lowercase kebab-case, 2–32 chars, starting with a letter`);
  }
  const at = (f) => `Plugin "${id}": ${f}`;

  if (typeof m.version !== "string" || !SEMVER_RE.test(m.version)) {
    throw new Error(at(`version "${m.version}" must be semver (e.g. "1.0.0")`));
  }
  if (typeof m.name !== "string" || !m.name.trim() || m.name.length > 40) {
    throw new Error(at("name must be a non-empty string ≤40 chars"));
  }
  if (typeof m.description !== "string" || !m.description.trim() || m.description.length > 200) {
    throw new Error(at("description must be a non-empty string ≤200 chars"));
  }
  // The icon replaces today's hardcoded ACT_LABEL emoji map, so it is required:
  // the room can announce "started Ludo 🎲" from the manifest alone.
  if (typeof m.icon !== "string" || !m.icon.trim() || [...m.icon].length > 4) {
    throw new Error(at("icon must be a short emoji string"));
  }
  if (!CATEGORIES.includes(m.category)) {
    throw new Error(at(`category "${m.category}" must be one of: ${CATEGORIES.join(", ")}`));
  }
  if (!SURFACES.includes(m.surface)) {
    throw new Error(at(`surface "${m.surface}" must be one of: ${SURFACES.join(", ")}`));
  }

  // ── permissions ──
  if (!Array.isArray(m.permissions)) throw new Error(at("permissions must be an array"));
  for (const p of m.permissions) {
    if (!(p in CAPABILITIES)) {
      throw new Error(at(`unknown permission "${p}". Known: ${Object.keys(CAPABILITIES).join(", ")}`));
    }
  }
  if (new Set(m.permissions).size !== m.permissions.length) {
    throw new Error(at("permissions contains duplicates"));
  }
  // Catch the contradiction early rather than at first emit.
  if (m.surface !== "headless" && !m.permissions.includes("room:read")) {
    throw new Error(at('a rendered plugin needs the "room:read" permission'));
  }

  // ── recommendedFor: purpose → weight, the data the engine scores on ──
  if (m.recommendedFor !== undefined) {
    if (!isPlainObject(m.recommendedFor)) throw new Error(at("recommendedFor must be an object"));
    for (const [purpose, weight] of Object.entries(m.recommendedFor)) {
      if (typeof weight !== "number" || !(weight >= 0 && weight <= 1)) {
        throw new Error(at(`recommendedFor.${purpose} must be a number between 0 and 1`));
      }
    }
  }

  // ── player bounds (games) ──
  const { minPlayers, maxPlayers } = m;
  for (const [k, v] of [["minPlayers", minPlayers], ["maxPlayers", maxPlayers]]) {
    if (v !== undefined && (!Number.isInteger(v) || v < 1 || v > 64)) {
      throw new Error(at(`${k} must be an integer 1..64`));
    }
  }
  if (Number.isInteger(minPlayers) && Number.isInteger(maxPlayers) && minPlayers > maxPlayers) {
    throw new Error(at(`minPlayers (${minPlayers}) > maxPlayers (${maxPlayers})`));
  }

  // ── dependencies (resolved by the registry once all manifests are in) ──
  if (m.requires !== undefined) {
    if (!Array.isArray(m.requires)) throw new Error(at("requires must be an array of plugin ids"));
    for (const dep of m.requires) {
      if (typeof dep !== "string" || !ID_RE.test(dep)) throw new Error(at(`requires contains invalid id "${dep}"`));
      if (dep === id) throw new Error(at("cannot require itself"));
    }
  }

  if (m.singleton !== undefined && typeof m.singleton !== "boolean") {
    throw new Error(at("singleton must be a boolean"));
  }

  validateConfigSchema(m.configSchema, id);
  return m;
}

/**
 * Freeze a validated manifest, deeply enough that a plugin cannot mutate a
 * manifest shared by every room on the server — a bug that would be nearly
 * impossible to trace back to its cause.
 */
export function freezeManifest(m) {
  const deepFreeze = (o) => {
    if (o === null || typeof o !== "object" || Object.isFrozen(o)) return o;
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
    return o;
  };
  return deepFreeze(m);
}
