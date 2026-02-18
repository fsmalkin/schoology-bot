import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDb } from "../src/db.js";
import { buildDashboardSnapshot } from "../src/dashboard_data.js";

function makeConfig(tempDir) {
  return {
    schedule: {
      timezone: "America/New_York",
      scrapeCron: "0 6 * * *",
      sendCron: "0 7 * * *",
      reminderCron: "*/1 * * * *",
    },
    liveChecks: { enabled: false, cron: "0 5 * * *" },
    paths: {
      dataDir: tempDir,
      statePath: path.join(tempDir, "state.json"),
      agentDbPath: path.join(tempDir, "agent.db"),
    },
  };
}

function seedAssignments(db) {
  db.prepare(
    `
    INSERT INTO assignments (
      key, course, title, due_date, status, score, url, raw_text,
      first_seen_at, last_seen_at, last_missing_at, resolved_at, is_missing, manual_status, auto_ignored
    )
    VALUES
      ('a1', 'Algebra: Sec 1', 'Homework 1', '2/20/26 11:59pm', 'Missing', '', '', '', '2026-02-10T00:00:00Z', '2026-02-16T00:00:00Z', '2026-02-16T00:00:00Z', NULL, 1, NULL, 0),
      ('a2', 'Latin: Sec 1', 'Quiz 1', '2/21/26 11:59pm', 'Missing', '', '', '', '2026-02-10T00:00:00Z', '2026-02-16T00:00:00Z', '2026-02-16T00:00:00Z', NULL, 1, 'Waiting on teacher', 0),
      ('a3', 'Science: Sec 1', 'Lab 1', '2/22/26 11:59pm', 'Missing', '', '', 'assignment submitted', '2026-02-10T00:00:00Z', '2026-02-16T00:00:00Z', '2026-02-16T00:00:00Z', NULL, 1, NULL, 0)
  `
  ).run();
}

function seedTasks(db) {
  db.prepare(
    `
    INSERT INTO tasks (assignment_key, title, message, remind_at, status, kind, auto_cancel_on_resolve, auto_planned, created_at)
    VALUES
      (NULL, 'Ask teacher', 'follow up', '2026-02-15T10:00:00Z', 'pending', 'personal', 0, 0, '2026-02-10T00:00:00Z'),
      (NULL, 'Read chapter', 'today', '2026-02-16T16:00:00Z', 'pending', 'personal', 0, 0, '2026-02-10T00:00:00Z'),
      (NULL, 'Practice', 'tomorrow', '2026-02-17T16:00:00Z', 'pending', 'personal', 0, 0, '2026-02-10T00:00:00Z')
  `
  ).run();
}

test("buildDashboardSnapshot reports core health and counts", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "schoology-dashboard-data-"));
  try {
    const config = makeConfig(tempDir);
    const db = createDb(":memory:");
    seedAssignments(db);
    seedTasks(db);

    const snapshot = buildDashboardSnapshot({
      config,
      now: new Date("2026-02-16T17:00:00Z"),
      dbOverride: db,
      stateOverride: {
        lastScrapeAt: "2026-02-16T11:00:00Z",
        lastSummarySentAt: "2026-02-16T12:00:00Z",
      },
      heartbeatsOverride: {
        scheduler: {
          timestamp: "2026-02-16T16:59:40Z",
          status: "running",
        },
        "telegram-agent": {
          timestamp: "2026-02-16T16:59:45Z",
          status: "running",
        },
      },
    });

    assert.equal(snapshot.assignments.actionable, 1);
    assert.equal(snapshot.assignments.waiting, 1);
    assert.equal(snapshot.assignments.ignored, 1);
    assert.equal(snapshot.tasks.pending, 3);
    assert.equal(snapshot.tasks.overdue, 1);
    assert.equal(snapshot.tasks.today, 1);
    assert.equal(snapshot.tasks.upcoming, 1);
    assert.equal(snapshot.services[0].state, "ok");
    assert.equal(snapshot.services[1].state, "ok");
    assert.equal(snapshot.activity.scrapeStale, false);
    assert.equal(snapshot.activity.summaryStale, false);
    assert.equal(Array.isArray(snapshot.quickCommands), true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("buildDashboardSnapshot supports openclaw runtime service set", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "schoology-dashboard-openclaw-"));
  try {
    const config = makeConfig(tempDir);
    config.runtime = { stack: "openclaw" };
    const db = createDb(":memory:");
    seedAssignments(db);

    const snapshot = buildDashboardSnapshot({
      config,
      now: new Date("2026-02-16T17:00:00Z"),
      dbOverride: db,
      stateOverride: {
        lastScrapeAt: "2026-02-16T11:00:00Z",
        lastSummarySentAt: "2026-02-16T12:00:00Z",
      },
      heartbeatsOverride: {
        "schoology-tool-api": {
          timestamp: "2026-02-16T16:59:40Z",
          status: "running",
        },
        "openclaw-gateway": {
          timestamp: "2026-02-16T16:59:45Z",
          status: "running",
        },
      },
    });

    assert.equal(snapshot.services.length, 2);
    assert.equal(snapshot.services[0].key, "schoology-tool-api");
    assert.equal(snapshot.services[1].key, "openclaw-gateway");
    assert.ok(snapshot.quickCommands.some((line) => line.includes("beta-openclaw")));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
