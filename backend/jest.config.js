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
