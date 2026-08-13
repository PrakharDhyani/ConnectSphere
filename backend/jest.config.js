/**
 * Jest config — native ESM (project is "type": "module"), no Babel.
 *
 * The test script runs Jest under `node --experimental-vm-modules`, which is
 * what lets `import`/`jest.unstable_mockModule` work without transpilation.
 * `transform: {}` disables the default babel-jest so files run as real ESM.
 */
export default {
  testEnvironment: "node",
  transform: {},
  testMatch: ["**/tests/**/*.test.js"],
  clearMocks: true,

  /**
   * WORKERS ARE CAPPED BECAUSE EACH ONE BOOTS ITS OWN DATABASE.
   *
   * `startHarness()` spins up a separate `MongoMemoryServer` per suite, so
   * Jest's default (cores - 1, i.e. ~15 here) means fifteen concurrent mongod
   * processes plus fifteen Express apps plus, for the socket suites, real
   * socket.io servers. On a 16-core box that tips over intermittently: whole
   * suites fail together with connection errors, which reads like a code
   * regression and is really resource starvation. Observed as 17 suites / 351
   * tests failing on one run and everything passing on the next, with no code
   * change in between.
   *
   * Four is comfortably under the tipping point and costs perhaps a minute of
   * wall-clock. A flaky suite costs far more than that in wasted debugging —
   * and worse, it teaches you to re-run instead of read the failure.
   */
  maxWorkers: 4,

  // Mongo binary boot on first run + a few flows per file; keep headroom.
  testTimeout: 30000,
  collectCoverageFrom: [
    "src/**/*.js",
    "!src/index.js", // entrypoint (boot + listen) — exercised, not unit-covered
    "!src/sockets/**", // socket layer not built yet
    "!src/config/kafka.js", // infra glue, no logic to assert
    "!src/utils/logger.js", // logging config
  ],
};
