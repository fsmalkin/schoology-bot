import test from "node:test";
import assert from "node:assert/strict";
import { createDb, createTask, listTasks } from "../src/db.js";
import { runToolByName } from "../src/tool_runner.js";

function seedAssignments(db) {
  db.prepare(
    `
    INSERT INTO assignments (
      key, course, title, due_date, status, score, url, raw_text,
      first_seen_at, last_seen_at, last_missing_at, resolved_at, is_missing, manual_status, auto_ignored
    )
    VALUES
      ('a1', 'Algebra: Sec 1', 'Homework 1', '2/20/26 11:59pm', 'Missing', '', '', '', '2026-02-10T00:00:00Z', '2026-02-16T00:00:00Z', '2026-02-16T00:00:00Z', NULL, 1, NULL, 0),
      ('a2', 'Latin: Sec 1', 'Quiz 1', '2/21/26 11:59pm', 'Missing', '', '', '', '2026-02-10T00:00:00Z', '2026-02-16T00:00:00Z', '2026-02-16T00:00:00Z', NULL, 1, 'Waiting on teacher', 0)
  `
  ).run();
}

test("build_daily_summary returns summary text and counts without sending", async () => {
  const db = createDb(":memory:");
  seedAssignments(db);

  const result = await runToolByName(db, "build_daily_summary", {
    now: "2026-02-16T17:00:00Z",
    state: {
      lastScrapeAt: "2026-02-16T11:00:00Z",
      lastSummarySentAt: null,
      assignments: {},
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.actionableCount, 1);
  assert.equal(result.pendingCount, 1);
  assert.equal(typeof result.summaryText, "string");
  assert.ok(result.summaryText.length > 0);
});

test("drain_due_reminders rolls due tasks and returns message payloads", async () => {
  const db = createDb(":memory:");
  createTask(db, {
    title: "Ask teacher",
    remindAt: "2026-02-16T16:30:00Z",
    message: "follow up",
  });
  createTask(db, {
    title: "Future task",
    remindAt: "2026-02-18T16:30:00Z",
    message: "not due yet",
  });

  const result = await runToolByName(db, "drain_due_reminders", {
    now: "2026-02-16T17:00:00Z",
  });

  assert.equal(result.ok, true);
  assert.equal(result.count, 1);
  assert.equal(Array.isArray(result.messages), true);
  assert.equal(result.messages.length, 1);
  assert.match(result.messages[0], /Ask teacher/i);

  const tasks = listTasks(db, { status: "pending" });
  const rolled = tasks.find((row) => row.title === "Ask teacher");
  assert.ok(rolled);
  assert.equal(rolled.remindAt, "2026-02-17T16:30:00.000Z");
});
