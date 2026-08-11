/**
 * Manifest provenance — where a plugin came from, and who vouches for it.
 *
 * THE SEAM, NOT THE FEATURE
 * Phase 7 is explicitly "architecture only". There is no marketplace, no remote
 * manifest, and no signing key — every plugin in this build is a file in this
 * repository, reviewed the same way the rest of the code is. Shipping actual
 * signature *verification* now would mean inventing a key format, a trust root
 * and a rotation story for a threat that does not exist yet, and every one of
 * those guesses would be made with no real requirement to check them against.
 *
 * What DOES have to exist now is the decision about where verification hooks in,
 * because that is the part which is expensive to retrofit. Registration is the
 * only place every manifest passes through — server boot and bundle init — so a
 * verifier installed here cannot be bypassed by a caller who forgot to ask.
 * That is the same reasoning that put validation in `registerPlugin` rather
 * than at each call site.
 *
 * DEFAULT: TRUST BUILT-INS, REFUSE EVERYTHING ELSE
 * With no verifier installed, a manifest carrying no `origin` is treated as
 * built-in and accepted; one claiming a remote origin is REFUSED. That
 * ordering matters. The alternative default — accept anything until someone
 * installs a verifier — means the day remote manifests become possible, they
 * are trusted by default and the security review happens after the feature
 * ships. Failing closed costs nothing today (nothing has a remote origin) and
 * is the only default that stays correct if this seam is forgotten for a year.
 *
 * Isomorphic: plain ESM, no imports, safe in Node and the browser.
 */

/** Where a manifest came from. `builtin` is the only one this build produces. */
export const ORIGINS = Object.freeze(["builtin", "remote"]);

/**
 * The installed verifier. Null means "no policy configured", which is not the
 * same as "allow everything" — see `verifyManifestOrigin`.
 */
let verifier = null;

/**
 * Install a provenance verifier.
 *
 * @param {null | (info: {id, version, origin, signature, manifest}) => (boolean | {ok: boolean, reason?: string})}
 *   fn  Return true / `{ok:true}` to accept. Anything else refuses, and the
 *       reason (if given) is surfaced in the thrown error.
 *
 * Returns the previous verifier so a caller — realistically a test — can put
 * it back without knowing what it was.
 */
export function setManifestVerifier(fn) {
  const prev = verifier;
  if (fn !== null && typeof fn !== "function") {
    throw new Error("setManifestVerifier expects a function or null");
  }
  verifier = fn;
  return prev;
}

/** Test/boot helper: is a custom policy in force? */
export const hasManifestVerifier = () => verifier !== null;

/**
 * Normalise the provenance fields off a manifest.
 *
 * Absent `origin` means built-in: every manifest written before this file
 * existed omits it, and rewriting nine manifests to say what is already true of
 * all of them would be noise. A manifest that IS remote has to say so.
 */
export function describeOrigin(manifest) {
  const origin = manifest?.origin || "builtin";
  return Object.freeze({
    origin,
    builtin: origin === "builtin",
    signature: manifest?.signature || null,
    signed: Boolean(manifest?.signature),
  });
}

/**
 * Gate a manifest at registration. Throws with a plugin-naming message, in the
 * same style as `validateManifest`, because the reader is the person adding it.
 *
 * @returns the normalised provenance, for the registry to freeze onto the entry.
 */
export function verifyManifestOrigin(manifest) {
  const info = describeOrigin(manifest);
  const id = manifest?.id ?? "(unknown)";

  if (!ORIGINS.includes(info.origin)) {
    throw new Error(`Plugin "${id}": unknown origin "${info.origin}" (expected ${ORIGINS.join(" or ")})`);
  }

  if (verifier) {
    const verdict = verifier({
      id,
      version: manifest?.version,
      origin: info.origin,
      signature: info.signature,
      manifest,
    });
    const ok = verdict === true || (verdict && verdict.ok === true);
    if (!ok) {
      const reason = (verdict && verdict.reason) || "failed provenance verification";
      throw new Error(`Plugin "${id}": ${reason}`);
    }
    return info;
  }

  /**
   * No verifier installed. Built-ins are files in this repo and are trusted for
   * the same reason the rest of the repo is; anything claiming to come from
   * elsewhere is refused until someone deliberately decides what "verified"
   * means. Fail closed — see the header.
   */
  if (!info.builtin) {
    throw new Error(
      `Plugin "${id}": origin "${info.origin}" requires a manifest verifier, and none is installed. ` +
      `Call setManifestVerifier() before registering non-builtin plugins.`
    );
  }
  return info;
}
