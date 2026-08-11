/**
 * Phase 7 — marketplace seams.
 *
 * The phase is explicitly "architecture only": no marketplace exists, no remote
 * manifest exists, and no signing key exists. What is under test is therefore
 * not a feature but a set of DECISIONS that are expensive to retrofit later:
 *
 *   1. **Version drift is legible.** `installed[].version` has been pinned
 *      since Phase 4 and compared by nothing, so a plugin could go 1.x → 2.x
 *      and every existing room would silently adopt the new grammar — the exact
 *      scenario pinning was introduced to prevent.
 *   2. **Provenance fails CLOSED.** With no verifier installed, a manifest
 *      claiming a remote origin is refused. The opposite default (allow until
 *      someone installs a policy) means the day remote manifests become
 *      possible they are trusted by default, and the security review happens
 *      after the feature ships.
 *   3. **The gate is at registration**, the one path every manifest takes, so a
 *      caller cannot bypass it by forgetting to ask.
 */
import { describe, it, expect, afterEach } from "@jest/globals";

import {
  parseVersion,
  compareVersions,
  versionStatus,
  isCompatible,
  describeVersion,
} from "../../shared/activities/version.js";
import {
  ORIGINS,
  describeOrigin,
  verifyManifestOrigin,
  setManifestVerifier,
  hasManifestVerifier,
} from "../../shared/activities/provenance.js";
import { resolveActivities, getPlugin, getAllPlugins } from "../../shared/activities/index.js";

afterEach(() => {
  // A verifier left installed would silently change every later registration.
  setManifestVerifier(null);
});

describe("semver parsing", () => {
  it("parses a well-formed version", () => {
    expect(parseVersion("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3 });
    expect(parseVersion("10.0.11")).toEqual({ major: 10, minor: 0, patch: 11 });
  });

  it("returns null rather than throwing on anything else", () => {
    // A room must never fail to open because of a field that only feeds a badge.
    for (const bad of ["1.2", "v1.2.3", "1.2.3-beta", "", null, undefined, 3, {}]) {
      expect(parseVersion(bad)).toBeNull();
    }
  });
});

describe("comparison", () => {
  it("orders by major, then minor, then patch", () => {
    expect(compareVersions("1.0.0", "2.0.0")).toBe(-1);
    expect(compareVersions("2.0.0", "1.9.9")).toBe(1);
    expect(compareVersions("1.2.0", "1.3.0")).toBe(-1);
    expect(compareVersions("1.2.3", "1.2.4")).toBe(-1);
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
  });

  it("treats unparseable input as EQUAL, not as lower", () => {
    // "I cannot tell" and "this is older" are different claims. Conflating them
    // would make a corrupt pin look like a pending upgrade.
    expect(compareVersions("garbage", "1.0.0")).toBe(0);
    expect(compareVersions("1.0.0", null)).toBe(0);
  });

  it("compares numerically, not lexically", () => {
    // The bug a string compare would produce: "10" < "9".
    expect(compareVersions("10.0.0", "9.0.0")).toBe(1);
    expect(compareVersions("1.10.0", "1.9.0")).toBe(1);
  });
});

describe("version status", () => {
  it("is current when the versions match", () => {
    expect(versionStatus("1.0.0", "1.0.0")).toBe("current");
  });

  it("treats a minor or patch bump as compatible, not a migration", () => {
    // A MAJOR bump is the author declaring a break; anything less is by
    // definition safe to adopt. Prompting on a patch would train people to
    // ignore the badge that matters.
    expect(versionStatus("1.0.0", "1.1.0")).toBe("outdated");
    expect(versionStatus("1.0.0", "1.0.7")).toBe("outdated");
    expect(isCompatible("outdated")).toBe(true);
  });

  it("flags a major bump as breaking", () => {
    expect(versionStatus("1.4.2", "2.0.0")).toBe("breaking");
    expect(isCompatible("breaking")).toBe(false);
  });

  it("distinguishes a pin that is AHEAD of the build", () => {
    // A rolled-back server, or a room synced from an environment running newer
    // code. Called out separately because the fix is on the server, not in the
    // room — reporting it as "breaking" would send someone to the wrong place.
    expect(versionStatus("3.0.0", "2.0.0")).toBe("ahead");
    expect(isCompatible("ahead")).toBe(false);
  });

  it("says unpinned for a legacy room and unknown for a missing plugin", () => {
    expect(versionStatus(undefined, "1.0.0")).toBe("unpinned");
    expect(versionStatus("", "1.0.0")).toBe("unpinned");
    // Nothing to compare against — consistent with `unavailable: true`.
    expect(versionStatus("1.0.0", undefined)).toBe("unknown");
    expect(versionStatus("1.0.0", "not-semver")).toBe("unknown");
  });

  it("treats an unpinned legacy room as compatible", () => {
    // Pre-plugin rooms have no pin and must keep working untouched.
    expect(isCompatible("unpinned")).toBe(true);
  });
});

describe("describeVersion", () => {
  it("only asks for attention on the two states someone can act on", () => {
    expect(describeVersion("1.0.0", "1.0.0").needsAttention).toBe(false);
    expect(describeVersion("1.0.0", "1.2.0").needsAttention).toBe(false); // patch/minor: silent
    expect(describeVersion("1.0.0", "2.0.0").needsAttention).toBe(true);
    expect(describeVersion("2.0.0", "1.0.0").needsAttention).toBe(true);
    expect(describeVersion(undefined, "1.0.0").needsAttention).toBe(false);
  });

  it("returns a frozen record carrying both versions", () => {
    const d = describeVersion("1.0.0", "2.0.0");
    expect(d).toMatchObject({ pinned: "1.0.0", current: "2.0.0", status: "breaking", compatible: false });
    expect(Object.isFrozen(d)).toBe(true);
  });
});

describe("resolveActivities surfaces drift", () => {
  const roomWith = (installed) => ({ activities: { configured: true, installed } });

  it("reports current for a room pinned to the shipped version", () => {
    const wb = getPlugin("whiteboard");
    const [entry] = resolveActivities(roomWith([{ id: "whiteboard", version: wb.version, enabled: true }]));
    expect(entry.version.status).toBe("current");
    expect(entry.version.compatible).toBe(true);
  });

  it("reports breaking for a room pinned to an older major", () => {
    const [entry] = resolveActivities(roomWith([{ id: "whiteboard", version: "0.9.0", enabled: true }]));
    expect(entry.version).toMatchObject({ pinned: "0.9.0", status: "breaking", needsAttention: true });
    // Still resolved, not dropped: the owner must be able to see and fix it.
    expect(entry.unavailable).toBe(false);
    expect(entry.manifest).toBeTruthy();
  });

  it("reports unpinned for a legacy room", () => {
    // No `activities` field at all — the pre-plugin case.
    const entries = resolveActivities({});
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) expect(e.version.status).toBe("unpinned");
  });

  it("reports unknown for a plugin this build does not have", () => {
    const [entry] = resolveActivities(roomWith([{ id: "ghost-plugin", version: "1.0.0", enabled: true }]));
    expect(entry.unavailable).toBe(true);
    expect(entry.version.status).toBe("unknown");
  });
});

describe("provenance", () => {
  const manifest = (extra = {}) => ({ id: "test-plugin", version: "1.0.0", ...extra });

  it("treats a manifest with no origin as built-in", () => {
    // Every manifest written before this file existed omits `origin`, and
    // rewriting nine of them to state what is true of all of them is noise.
    const info = describeOrigin(manifest());
    expect(info).toMatchObject({ origin: "builtin", builtin: true, signed: false });
    expect(verifyManifestOrigin(manifest())).toMatchObject({ builtin: true });
  });

  it("REFUSES a remote manifest when no verifier is installed", () => {
    // The load-bearing default. Failing closed costs nothing today (nothing has
    // a remote origin) and stays correct if this seam is forgotten for a year.
    expect(hasManifestVerifier()).toBe(false);
    expect(() => verifyManifestOrigin(manifest({ origin: "remote" }))).toThrow(/requires a manifest verifier/);
  });

  it("rejects an origin that is not a known kind", () => {
    expect(() => verifyManifestOrigin(manifest({ origin: "sideloaded" }))).toThrow(/unknown origin/);
    expect(ORIGINS).toContain("builtin");
  });

  it("lets an installed verifier accept a remote manifest", () => {
    setManifestVerifier(({ origin, signature }) => origin === "builtin" || signature === "good-sig");
    expect(() => verifyManifestOrigin(manifest({ origin: "remote", signature: "good-sig" }))).not.toThrow();
    expect(() => verifyManifestOrigin(manifest({ origin: "remote", signature: "forged" }))).toThrow();
  });

  it("surfaces the verifier's own reason in the error", () => {
    setManifestVerifier(() => ({ ok: false, reason: "signature expired" }));
    expect(() => verifyManifestOrigin(manifest())).toThrow(/signature expired/);
  });

  it("applies the verifier to BUILT-INS too, not just remote ones", () => {
    // A policy that cannot inspect first-party plugins is not a policy — it is
    // a filter on strangers. The kill-switch has to cover everything.
    setManifestVerifier(() => false);
    expect(() => verifyManifestOrigin(manifest())).toThrow(/failed provenance verification/);
  });

  it("returns the previous verifier so a caller can restore it", () => {
    const first = () => true;
    setManifestVerifier(first);
    const prev = setManifestVerifier(null);
    expect(prev).toBe(first);
  });

  it("refuses a non-function verifier", () => {
    expect(() => setManifestVerifier("nope")).toThrow(/function or null/);
  });
});

describe("the registry records verified provenance", () => {
  it("stamps every built-in with its origin at registration", () => {
    // Derived and stored, not re-derived by each consumer — a marketplace UI or
    // audit log must read the same answer the gate acted on.
    const all = getAllPlugins();
    expect(all.length).toBeGreaterThan(0);
    for (const p of all) {
      expect(p.provenance).toMatchObject({ origin: "builtin", builtin: true });
    }
  });

  it("freezes it along with the rest of the manifest", () => {
    expect(Object.isFrozen(getPlugin("whiteboard").provenance)).toBe(true);
  });
});
