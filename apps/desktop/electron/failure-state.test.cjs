const test = require("node:test");
const assert = require("node:assert/strict");
const {
  FAILURE_COPY,
  classifyStartupFailure,
  failureCopy,
} = require("./failure-state.cjs");

test("classifies database migration startup failures separately", () => {
  assert.equal(
    classifyStartupFailure("Database migration failed while applying 123"),
    "database_migration_failed",
  );
  assert.equal(
    classifyStartupFailure("backend did not become ready"),
    "host_unavailable",
  );
});

test("every native startup failure has complete recovery copy", () => {
  for (const kind of [
    "database_migration_failed",
    "host_unavailable",
    "webview_failed",
  ]) {
    const copy = failureCopy(kind);
    assert.ok(copy.title);
    assert.ok(copy.body);
    assert.ok(copy.action);
  }
  assert.equal(Object.keys(FAILURE_COPY).length, 3);
});
