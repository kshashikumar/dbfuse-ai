// Fuzz test for connection config normalization (JavaScript version)
// Run with: node tests/fuzz/connection.fuzz.test.js
// Requires dev dependency: fast-check
const fc = require("fast-check");

function buildConnectionConfig({ host, port, user, password }) {
  const safeHost =
    typeof host === "string" && host.trim()
      ? host
          .replace(/[\r\n\t]/g, "")
          .trim()
          .slice(0, 255)
      : "localhost";
  const safePort = Number.isInteger(port) && port > 0 && port <= 65535 ? port : 5000;
  const username = typeof user === "string" && user.trim() ? user.trim().slice(0, 128) : "root";
  const pwd = typeof password === "string" ? password.slice(0, 512) : "root";
  return { host: safeHost, port: safePort, username, password: pwd, dbType: "mysql" };
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || "Assertion failed");
}

fc.assert(
  fc.property(
    fc.string(),
    fc.integer({ min: 0, max: 100000 }),
    fc.string(),
    fc.string(),
    (host, port, user, password) => {
      const cfg = buildConnectionConfig({ host, port, user, password });
      assert(cfg && typeof cfg === "object", "Config object not returned");
      assert(typeof cfg.host === "string" && cfg.host.length > 0, "Invalid host");
      assert(Number.isInteger(cfg.port) && cfg.port > 0 && cfg.port <= 65535, "Invalid port");
      assert(typeof cfg.username === "string" && cfg.username.length > 0, "Invalid username");
      assert(typeof cfg.password === "string", "Invalid password");
    },
  ),
  { numRuns: 250 },
);

// eslint-disable-next-line no-console
console.log("connection.fuzz.test: passed 250 randomized cases");
