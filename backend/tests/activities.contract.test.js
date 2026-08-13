/**
 * The Activity Plugin contract — manifest validation, the config grammar, the
 * registry and legacy-room compatibility.
 *
 * Pure functions over shared/ data: no Mongo, no supertest, no harness. These
 * are the tests that must fail LOUDLY when someone adds a malformed plugin,
 * because that is the whole promise of the architecture — adding a plugin
 * cannot break the app, and getting one wrong is caught at boot.
 */
import { describe, it, expect, beforeEach } from "@jest/globals";

import { validateManifest, CAPABILITIES, CATEGORIES, SURFACES } from "../../shared/activities/manifest.js";
import { validateConfigSchema, coerceConfig, defaultsFor, FIELD_TYPES } from "../../shared/activities/config-schema.js";
import {
  registerPlugin, getPlugin, getAllPlugins, getPluginsByCategory, getPluginsBySurface,
  getRecommendedPlugins, getDefaultConfig, validateDependencies, __resetRegistry,
} from "../../shared/activities/registry.js";
import {
  resolveInstalled, resolveActivities, resolveActiveActivity, isActivityEnabled,
  getActivityConfig, materializeLegacy, LEGACY_ACTIVITY_IDS, assertLegacyIdsRegistered,
} from "../../shared/activities/compat.js";
import { registerBuiltInActivities, BUILT_IN } from "../../shared/activities/index.js";
import { PURPOSES, PURPOSE_IDS, SCORABLE_PURPOSE_IDS, isValidPurpose } from "../../shared/activities/purposes.js";

// A minimal valid manifest; each test overrides just the field under test.
const base = (over = {}) => ({
  id: "test-plugin",
  version: "1.0.0",
  name: "Test Plugin",
  description: "A plugin used only by the contract tests.",
  icon: "🧪",
  category: "games",
  surface: "game",
  permissions: ["room:read"],
  ...over,
});

describe("validateManifest", () => {
  it("accepts a minimal valid manifest", () => {
    expect(() => validateManifest(base())).not.toThrow();
  });

  it.each([
    ["Test", "uppercase"],
    ["test plugin", "a space"],
    ["test_plugin", "an underscore"],
    ["9lives", "a leading digit"],
    ["a", "one character"],
    ["x".repeat(33), "33 characters"],
  ])('rejects id "%s" (%s)', (id) => {
    expect(() => validateManifest(base({ id }))).toThrow(/kebab-case/);
  });

  it.each(["1.0", "v1.0.0", "1.0.0-beta", "latest"])("rejects non-semver version %s", (version) => {
    expect(() => validateManifest(base({ version }))).toThrow(/semver/);
  });

  it("rejects an unknown permission and names the known ones", () => {
    expect(() => validateManifest(base({ permissions: ["room:read", "chat:post"] })))
      .toThrow(/unknown permission "chat:post"/);
  });

  it("rejects duplicate permissions", () => {
    expect(() => validateManifest(base({ permissions: ["room:read", "room:read"] })))
      .toThrow(/duplicates/);
  });

  it("requires room:read for anything that renders, but not for headless", () => {
    expect(() => validateManifest(base({ permissions: [] }))).toThrow(/room:read/);
    expect(() => validateManifest(base({ surface: "headless", permissions: [] }))).not.toThrow();
  });

  it("rejects an unknown category or surface", () => {
    expect(() => validateManifest(base({ category: "misc" }))).toThrow(/category/);
    expect(() => validateManifest(base({ surface: "modal" }))).toThrow(/surface/);
  });

  it("rejects recommendedFor weights outside 0..1", () => {
    expect(() => validateManifest(base({ recommendedFor: { fun: 1.5 } }))).toThrow(/between 0 and 1/);
    expect(() => validateManifest(base({ recommendedFor: { fun: -0.1 } }))).toThrow(/between 0 and 1/);
    expect(() => validateManifest(base({ recommendedFor: { fun: 0 } }))).not.toThrow();
  });

  it("rejects minPlayers > maxPlayers", () => {
    expect(() => validateManifest(base({ minPlayers: 5, maxPlayers: 2 }))).toThrow(/minPlayers/);
  });

  it("rejects a plugin requiring itself", () => {
    expect(() => validateManifest(base({ requires: ["test-plugin"] }))).toThrow(/require itself/);
  });

  it("names the plugin in every error, so the author knows which file to open", () => {
    expect(() => validateManifest(base({ id: "my-game", category: "nope" })))
      .toThrow(/Plugin "my-game"/);
  });
});

describe("config schema grammar", () => {
  it("requires a default on every field", () => {
    expect(() => validateConfigSchema({ x: { type: "boolean", label: "X" } })).toThrow(/default is required/);
  });

  it("rejects a type outside the closed grammar", () => {
    // The whole point of the closed grammar: an unrenderable field is a boot
    // error, not a setting that silently vanishes from the wizard.
    expect(() => validateConfigSchema({ x: { type: "object", label: "X", default: {} } }))
      .toThrow(/is not one of/);
    expect(FIELD_TYPES).toEqual(["boolean", "number", "range", "string", "select", "multiselect"]);
  });

  it("rejects a default that contradicts its own constraints", () => {
    expect(() => validateConfigSchema({ n: { type: "number", label: "N", default: 99, min: 1, max: 10 } }))
      .toThrow(/above max/);
    expect(() => validateConfigSchema({ s: { type: "select", label: "S", default: "c", options: [{ value: "a", label: "A" }] } }))
      .toThrow(/not one of the options/);
  });

  it("requires range fields to be bounded (a slider must be drawable)", () => {
    expect(() => validateConfigSchema({ r: { type: "range", label: "R", default: 5 } }))
      .toThrow(/requires finite min and max/);
  });

  it("rejects duplicate option values", () => {
    expect(() => validateConfigSchema({
      s: { type: "select", label: "S", default: "a", options: [{ value: "a", label: "A" }, { value: "a", label: "Again" }] },
    })).toThrow(/duplicate option value/);
  });

  it("rejects min > max", () => {
    expect(() => validateConfigSchema({ n: { type: "number", label: "N", default: 5, min: 10, max: 2 } }))
      .toThrow(/min \(10\) > max \(2\)/);
  });
});

describe("coerceConfig — the trust boundary for client-supplied config", () => {
  const schema = {
    flag: { type: "boolean", label: "Flag", default: true },
    count: { type: "number", label: "Count", default: 4, min: 2, max: 8, integer: true },
    mode: { type: "select", label: "Mode", default: "a", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }] },
    tags: { type: "multiselect", label: "Tags", default: [], options: [{ value: "x", label: "X" }, { value: "y", label: "Y" }] },
    note: { type: "string", label: "Note", default: "", maxLength: 10 },
  };

  it("returns defaults for empty or non-object input", () => {
    expect(coerceConfig(schema, undefined).config).toEqual(defaultsFor(schema));
    expect(coerceConfig(schema, null).config).toEqual(defaultsFor(schema));
    expect(coerceConfig(schema, "nope").config).toEqual(defaultsFor(schema));
  });

  it("drops unknown keys instead of storing them", () => {
    const { config, warnings } = coerceConfig(schema, { evil: "payload", flag: false });
    expect(config).not.toHaveProperty("evil");
    expect(config.flag).toBe(false);
    expect(warnings.join()).toMatch(/unknown setting "evil"/);
  });

  it("clamps numbers into range rather than rejecting the whole config", () => {
    expect(coerceConfig(schema, { count: 999 }).config.count).toBe(8);
    expect(coerceConfig(schema, { count: -5 }).config.count).toBe(2);
    expect(coerceConfig(schema, { count: 5.7 }).config.count).toBe(6); // integer: true
  });

  it("falls back to the default for a wrong type, keeping other fields", () => {
    const { config, warnings } = coerceConfig(schema, { flag: "yes", mode: "b" });
    expect(config.flag).toBe(true);   // default, not "yes"
    expect(config.mode).toBe("b");    // the valid sibling survives
    expect(warnings.join()).toMatch(/"flag" is not a boolean/);
  });

  it("rejects an option that is not in the list", () => {
    expect(coerceConfig(schema, { mode: "zzz" }).config.mode).toBe("a");
  });

  it("filters and de-duplicates multiselect values", () => {
    const { config } = coerceConfig(schema, { tags: ["x", "bogus", "x", "y"] });
    expect(config.tags).toEqual(["x", "y"]);
  });

  it("truncates over-long strings", () => {
    const { config, warnings } = coerceConfig(schema, { note: "x".repeat(50) });
    expect(config.note).toHaveLength(10);
    expect(warnings.join()).toMatch(/truncated/);
  });

  it("never throws, whatever it is handed", () => {
    for (const junk of [[], 0, true, { count: {} }, { tags: "no" }, { note: 5 }]) {
      expect(() => coerceConfig(schema, junk)).not.toThrow();
    }
  });

  it("does not share mutable array defaults between calls", () => {
    // A shared default array would let one room's edit leak into every other
    // room that never customised the field.
    const a = coerceConfig(schema, {}).config;
    const b = coerceConfig(schema, {}).config;
    a.tags.push("x");
    expect(b.tags).toEqual([]);
  });
});

describe("registry", () => {
  beforeEach(() => {
    __resetRegistry();
    registerPlugin(base({ id: "alpha", category: "games", surface: "game", recommendedFor: { fun: 1.0, study: 0.2 } }));
    registerPlugin(base({ id: "beta", category: "creativity", surface: "board", recommendedFor: { study: 0.9 } }));
  });

  it("registers and looks up by id, category and surface", () => {
    expect(getPlugin("alpha").name).toBe("Test Plugin");
    expect(getPlugin("nope")).toBeNull();
    expect(getPluginsByCategory("games").map((p) => p.id)).toEqual(["alpha"]);
    expect(getPluginsBySurface("board").map((p) => p.id)).toEqual(["beta"]);
    expect(getAllPlugins()).toHaveLength(2);
  });

  it("rejects a duplicate id", () => {
    expect(() => registerPlugin(base({ id: "alpha" }))).toThrow(/Duplicate plugin id/);
  });

  it("rejects recommendedFor pointing at a purpose that does not exist", () => {
    // Without this, a typo like `studdy: 1` is silent — the plugin simply never
    // gets recommended and nobody finds out for months.
    expect(() => registerPlugin(base({ id: "gamma", recommendedFor: { studdy: 1 } })))
      .toThrow(/not a known purpose/);
  });

  it("freezes manifests so one plugin cannot mutate another's", () => {
    const p = getPlugin("alpha");
    expect(() => { p.name = "hacked"; }).toThrow();
    expect(getPlugin("alpha").name).toBe("Test Plugin");
  });

  it("sorts recommendations by weight and honours the threshold", () => {
    expect(getRecommendedPlugins("study").map((p) => p.id)).toEqual(["beta"]); // alpha is 0.2, below 0.5
    expect(getRecommendedPlugins("study", { minWeight: 0.1 }).map((p) => p.id)).toEqual(["beta", "alpha"]);
    expect(getRecommendedPlugins("music")).toEqual([]);
  });

  it("returns declared defaults as the default config", () => {
    __resetRegistry();
    registerPlugin(base({ id: "cfg", configSchema: { a: { type: "boolean", label: "A", default: true } } }));
    expect(getDefaultConfig("cfg")).toEqual({ a: true });
    expect(getDefaultConfig("missing")).toEqual({});
  });

  describe("dependencies", () => {
    it("rejects a requirement on an unregistered plugin", () => {
      __resetRegistry();
      registerPlugin(base({ id: "needy", requires: ["ghost"] }));
      expect(() => validateDependencies()).toThrow(/requires "ghost"/);
    });

    it("allows a dependency registered after its dependent", () => {
      // Order must not matter — that is why the check is deferred to boot.
      __resetRegistry();
      registerPlugin(base({ id: "needy", requires: ["provider"] }));
      registerPlugin(base({ id: "provider" }));
      expect(validateDependencies()).toBe(true);
    });

    it("detects a cycle and reports the path", () => {
      __resetRegistry();
      registerPlugin(base({ id: "a-one", requires: ["b-two"] }));
      registerPlugin(base({ id: "b-two", requires: ["c-three"] }));
      registerPlugin(base({ id: "c-three", requires: ["a-one"] }));
      expect(() => validateDependencies()).toThrow(/cycle/);
    });

    it("accepts a diamond (shared dependency, no cycle)", () => {
      __resetRegistry();
      registerPlugin(base({ id: "top", requires: ["left", "right"] }));
      registerPlugin(base({ id: "left", requires: ["bottom"] }));
      registerPlugin(base({ id: "right", requires: ["bottom"] }));
      registerPlugin(base({ id: "bottom" }));
      expect(validateDependencies()).toBe(true);
    });
  });
});

describe("built-in manifests", () => {
  beforeEach(() => {
    // index.js auto-registers on import; re-register onto a clean registry so
    // these assertions do not depend on which test ran first.
    __resetRegistry();
    for (const m of BUILT_IN) registerPlugin(m);
  });

  it("registers every built-in activity", () => {
    // Derived from BUILT_IN rather than a literal: a hardcoded count has to be
    // edited by anyone adding a plugin, which is the exact coupling the plugin
    // system exists to remove — and it fails as "expected 9, got 10", which
    // says nothing about what is wrong.
    expect(getAllPlugins()).toHaveLength(BUILT_IN.length);
    expect(getAllPlugins().map((p) => p.id).sort()).toEqual(BUILT_IN.map((m) => m.id).sort());
  });

  it("every built-in passes validation", () => {
    for (const m of BUILT_IN) expect(() => validateManifest(m)).not.toThrow();
  });

  it("every built-in has a renderable config schema with usable defaults", () => {
    for (const m of BUILT_IN) {
      expect(() => validateConfigSchema(m.configSchema, m.id)).not.toThrow();
      // Defaults must survive a round-trip through the trust boundary
      // unchanged, or the wizard would show one thing and store another.
      const defaults = defaultsFor(m.configSchema);
      expect(coerceConfig(m.configSchema, defaults).config).toEqual(defaults);
    }
  });

  it("keeps ids that already exist on the wire (skribbl, kart, typing)", () => {
    // These ids are baked into socket event names and the sessionStorage key
    // GamesHub uses to restore the open game. Renaming one breaks live
    // sessions for no benefit — this test is here to make that deliberate.
    for (const id of ["skribbl", "kart", "typing"]) expect(getPlugin(id)).not.toBeNull();
  });

  it("declares player bounds matching the game handlers", () => {
    expect(getPlugin("chess").maxPlayers).toBe(2);
    expect(getPlugin("ludo").maxPlayers).toBe(4);   // four coloured seats
    expect(getPlugin("uno").maxPlayers).toBe(6);
    expect(getPlugin("typing").maxPlayers).toBe(8);
    expect(getPlugin("bingo").maxPlayers).toBe(10);
    expect(getPlugin("kart").maxPlayers).toBe(10);  // MAX_KARTS
    expect(getPlugin("typing").minPlayers).toBe(1); // solo practice is supported
  });

  it("does not register polls as a plugin — they are core", () => {
    // Polls were briefly a plugin and were taken back out: a room where you
    // cannot ask a quick question is a downgrade, not a configuration. They
    // live in sockets/poll.handlers.js alongside chat and voice, so they must
    // NOT appear in the catalogue the wizard and the manager render from.
    expect(getPlugin("poll")).toBeNull();
  });

  /**
   * A purpose card that recommends nothing is a dead end in the wizard.
   *
   * "music" is a KNOWN, DELIBERATE gap: there is no music activity yet (Music
   * Room is Tier 2 in the catalogue). The honest fix is to build the plugin,
   * not to pad some manifest with a fake `music` weight to make this green —
   * that would lie to the recommendation engine and put Bingo in front of
   * someone who asked for music.
   *
   * So the gap is named here rather than hidden. Phase 4's wizard must handle
   * an empty recommendation set (fall back to popularity + "browse all"), and
   * this test proves music is the ONLY purpose that needs that path.
   */
  const PURPOSES_WITHOUT_PLUGINS = ["music"];

  it("gives every scorable purpose at least one recommendation, except known gaps", () => {
    for (const purpose of SCORABLE_PURPOSE_IDS) {
      const count = getRecommendedPlugins(purpose, { minWeight: 0.3 }).length;
      if (PURPOSES_WITHOUT_PLUGINS.includes(purpose)) expect(count).toBe(0);
      else expect(count).toBeGreaterThan(0);
    }
  });

  it("has no unlisted dead-end purposes", () => {
    // Separate from the test above so that shipping the Music Room plugin
    // FAILS here — a reminder to delete it from the known-gaps list rather
    // than leaving a stale exemption behind.
    const dead = SCORABLE_PURPOSE_IDS.filter((p) => getRecommendedPlugins(p, { minWeight: 0.3 }).length === 0);
    expect(dead).toEqual(PURPOSES_WITHOUT_PLUGINS);
  });

  it("has no unresolved or circular dependencies", () => {
    expect(validateDependencies()).toBe(true);
  });
});

describe("purposes", () => {
  it("exposes ten cards with custom last", () => {
    expect(PURPOSES).toHaveLength(10);
    expect(PURPOSES.at(-1).id).toBe("custom");
    expect(SCORABLE_PURPOSE_IDS).not.toContain("custom");
  });

  it("validates membership", () => {
    expect(isValidPurpose("study")).toBe(true);
    expect(isValidPurpose("studdy")).toBe(false);
  });

  it("has unique ids and a complete card for each", () => {
    expect(new Set(PURPOSE_IDS).size).toBe(PURPOSES.length);
    for (const p of PURPOSES) {
      expect(p.icon).toBeTruthy();
      expect(p.label).toBeTruthy();
      expect(p.blurb).toBeTruthy();
    }
  });
});

describe("backward compatibility — legacy rooms", () => {
  beforeEach(() => {
    __resetRegistry();
    for (const m of BUILT_IN) registerPlugin(m);
  });

  it("treats a room with no activities field as having everything", () => {
    // The core promise: existing rooms behave exactly as they do today, with
    // no migration run against them.
    const ids = resolveInstalled({ name: "Old room" }).map((a) => a.id);
    expect(ids).toEqual([...LEGACY_ACTIVITY_IDS]);
  });

  it.each([
    ["undefined activities", {}],
    ["empty activities object", { activities: {} }],
    ["empty installed array", { activities: { installed: [] } }],
    ["null room", null],
  ])("falls back for %s", (_label, room) => {
    expect(resolveInstalled(room).map((a) => a.id)).toEqual([...LEGACY_ACTIVITY_IDS]);
  });

  it("marks the fallback as legacy so the UI can say 'using defaults'", () => {
    expect(resolveInstalled({}).every((a) => a.legacy)).toBe(true);
    const modern = { activities: { installed: [{ id: "ludo", config: {}, enabled: true }] } };
    expect(resolveInstalled(modern)[0].legacy).toBeUndefined();
  });

  it("honours an explicit list once a room has one", () => {
    const room = { activities: { installed: [{ id: "chess", config: {}, enabled: true }] } };
    expect(resolveInstalled(room).map((a) => a.id)).toEqual(["chess"]);
    expect(isActivityEnabled(room, "chess")).toBe(true);
    expect(isActivityEnabled(room, "ludo")).toBe(false);
  });

  it("treats a disabled activity as unavailable without uninstalling it", () => {
    const room = { activities: { installed: [{ id: "chess", enabled: false }] } };
    expect(isActivityEnabled(room, "chess")).toBe(false);
    expect(resolveInstalled(room).map((a) => a.id)).toEqual(["chess"]);
  });

  it("layers stored config over plugin defaults", () => {
    const room = { activities: { installed: [{ id: "ludo", config: { maxPlayers: 2 } }] } };
    const cfg = getActivityConfig(room, "ludo");
    expect(cfg.maxPlayers).toBe(2);      // stored
    expect(cfg.allowBots).toBe(true);    // default fills the rest
  });

  it("surfaces an unknown plugin instead of silently dropping it", () => {
    // A room can reference a plugin this build does not have — dropping the
    // entry makes the tab vanish unexplained AND leaves it uninstallable.
    const room = { activities: { installed: [{ id: "from-the-future", config: {} }] } };
    const [entry] = resolveActivities(room);
    expect(entry.unavailable).toBe(true);
    expect(entry.manifest).toBeNull();
    expect(entry.id).toBe("from-the-future");
  });

  describe("active activity", () => {
    it("is null for a legacy room (the chat surface)", () => {
      expect(resolveActiveActivity({})).toBeNull();
    });

    it("returns a valid stored pointer", () => {
      const room = { activities: { installed: [{ id: "ludo", enabled: true }], active: "ludo" } };
      expect(resolveActiveActivity(room)).toBe("ludo");
    });

    it.each([
      ["uninstalled", { installed: [{ id: "chess", enabled: true }], active: "ludo" }],
      ["disabled", { installed: [{ id: "ludo", enabled: false }], active: "ludo" }],
      ["missing from this build", { installed: [{ id: "ghost", enabled: true }], active: "ghost" }],
    ])("falls back when the pointer names something %s", (_label, activities) => {
      // Opening a room must never fail because of a stale pointer.
      expect(resolveActiveActivity({ activities })).toBeNull();
    });
  });

  it("materializes a legacy room into an editable explicit list", () => {
    const list = materializeLegacy({});
    expect(list.map((a) => a.id)).toEqual([...LEGACY_ACTIVITY_IDS]);
    expect(list.every((a) => a.version && a.enabled)).toBe(true);
    // Config is concrete, not a promise to fill in later.
    expect(materializeLegacy({}).find((a) => a.id === "ludo").config.maxPlayers).toBe(4);
  });

  it("leaves an already-explicit room untouched", () => {
    const installed = [{ id: "chess", config: { allowBots: false }, enabled: true }];
    expect(materializeLegacy({ activities: { installed } })).toBe(installed);
  });

  it("catches a legacy id that no longer matches a registered plugin", () => {
    // Renaming a plugin id without updating LEGACY_ACTIVITY_IDS would silently
    // strip that activity from every pre-plugin room.
    expect(assertLegacyIdsRegistered()).toBe(true);
    __resetRegistry();
    expect(() => assertLegacyIdsRegistered()).toThrow(/unregistered plugin/);
  });
});

describe("capability contract", () => {
  it("keeps v1 to the five capabilities whiteboard and games need", () => {
    // Guards against capability creep: chat/video/AI are deliberately absent
    // because nothing in scope needs them. Adding one is a design decision,
    // so it should require updating this test.
    expect(Object.keys(CAPABILITIES).sort()).toEqual([
      "events:listen", "presence:read", "room:read", "socket:namespaced", "storage:room",
    ]);
  });

  it("every built-in requests only declared capabilities", () => {
    for (const m of BUILT_IN) {
      for (const p of m.permissions) expect(CAPABILITIES).toHaveProperty(p);
    }
  });

  it("exposes stable category and surface vocabularies", () => {
    expect(CATEGORIES).toContain("games");
    expect(SURFACES).toEqual(["board", "game", "tab", "overlay", "headless"]);
  });
});
