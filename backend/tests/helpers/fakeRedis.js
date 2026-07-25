/**
 * In-memory stand-in for the node-redis v4 client, implementing exactly the
 * command surface our services touch (see refreshToken.service.js and
 * authToken.service.js): set (with { EX }), get, getDel, del, sAdd, sRem,
 * sMembers, expire.
 *
 * Why fake Redis instead of a real one? Keeps `npm test` dependency-free and
 * fast — no Docker, no redis-server on the CI box. TTLs are accepted but not
 * enforced: nothing in the test suite depends on wall-clock expiry (token
 * expiry is exercised via JWT `expiresIn`, not Redis eviction).
 */
export function makeFakeRedis() {
  const store = new Map(); // string keys → string values
  const sets = new Map(); // string keys → Set<string>

  return {
    async set(key, value /*, opts */) {
      store.set(key, String(value));
      return "OK";
    },

    async get(key) {
      return store.has(key) ? store.get(key) : null;
    },

    // Atomic read-and-delete — the property single-use tokens rely on.
    async getDel(key) {
      const value = store.has(key) ? store.get(key) : null;
      store.delete(key);
      return value;
    },

    async del(keys) {
      const arr = Array.isArray(keys) ? keys : [keys];
      let removed = 0;
      for (const key of arr) {
        if (store.delete(key)) removed += 1;
        sets.delete(key);
      }
      return removed;
    },

    async sAdd(key, member) {
      if (!sets.has(key)) sets.set(key, new Set());
      const set = sets.get(key);
      const existed = set.has(member);
      set.add(member);
      return existed ? 0 : 1;
    },

    async sRem(key, member) {
      const set = sets.get(key);
      if (!set) return 0;
      return set.delete(member) ? 1 : 0;
    },

    async sMembers(key) {
      const set = sets.get(key);
      return set ? [...set] : [];
    },

    async expire() {
      return 1; // accepted, not enforced (see file header)
    },

    // ── test-only helpers ──
    __flush() {
      store.clear();
      sets.clear();
    },
    __store: store,
    __sets: sets,
  };
}
