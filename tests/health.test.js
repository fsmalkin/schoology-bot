import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  formatDurationMinutes,
  getHeartbeatPath,
  readServiceHeartbeat,
  summarizeHeartbeat,
  writeServiceHeartbeat,
} from "../src/health.js";

function makeConfig(dir) {
  return {
    paths: {
      dataDir: dir,
    },
  };
}

test("health heartbeat write/read/summarize", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "schoology-health-"));
  try {
    const config = makeConfig(dir);
    const written = writeServiceHeartbeat(config, "scheduler", { status: "running" });
    assert.equal(written.service, "scheduler");

    const saved = readServiceHeartbeat(config, "scheduler");
    assert.ok(saved);
    assert.equal(saved.status, "running");
    assert.ok(saved.timestamp);

    const summary = summarizeHeartbeat(saved, new Date(saved.timestamp), 1000);
    assert.equal(summary.state, "ok");
    assert.equal(summary.ok, true);

    const stale = summarizeHeartbeat(saved, new Date(Date.parse(saved.timestamp) + 600000), 1000);
    assert.equal(stale.state, "stale");
    assert.equal(stale.ok, false);

    const missing = summarizeHeartbeat(null, new Date(), 1000);
    assert.equal(missing.state, "down");
    assert.equal(formatDurationMinutes(61000), "1 min");

    const hbPath = getHeartbeatPath(config, "scheduler");
    assert.ok(fs.existsSync(hbPath));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
