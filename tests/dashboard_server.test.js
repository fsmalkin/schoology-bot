import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { closeDb } from "../src/db.js";
import { createDashboardServer, renderDashboardPage } from "../src/dashboard_server.js";

function makeConfig(tempDir) {
  return {
    schedule: {
      timezone: "America/New_York",
      scrapeCron: "0 6 * * *",
      sendCron: "0 7 * * *",
      reminderCron: "*/1 * * * *",
    },
    liveChecks: {
      enabled: false,
      cron: "0 5 * * *",
    },
    paths: {
      dataDir: tempDir,
      statePath: path.join(tempDir, "state.json"),
      agentDbPath: path.join(tempDir, "agent.db"),
    },
  };
}

test("renderDashboardPage includes key UI sections", () => {
  const html = renderDashboardPage();
  assert.match(html, /Schoology Health Dashboard/i);
  assert.match(html, /Today At A Glance/i);
  assert.match(html, /How It Works/i);
  assert.match(html, /\/api\/health/);
});

test("dashboard server serves page and api health", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "schoology-dashboard-server-"));
  const config = makeConfig(tempDir);
  fs.writeFileSync(
    config.paths.statePath,
    JSON.stringify(
      {
        meta: { createdAt: new Date().toISOString() },
        lastScrapeAt: null,
        lastSummarySentAt: null,
        assignments: {},
      },
      null,
      2
    ),
    "utf8"
  );

  const server = createDashboardServer({ config, logger: { log: () => {} } });
  try {
    await server.start(0);
    const address = server.server.address();
    const port = address && typeof address === "object" ? address.port : 0;
    assert.ok(port > 0);

    const page = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /Schoology Health Dashboard/i);

    const api = await fetch(`http://127.0.0.1:${port}/api/health`);
    assert.equal(api.status, 200);
    const payload = await api.json();
    assert.ok(payload.generatedAt);
    assert.ok(Array.isArray(payload.services));
  } finally {
    await server.stop();
    closeDb();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
