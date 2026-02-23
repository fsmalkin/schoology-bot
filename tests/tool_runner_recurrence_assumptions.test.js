import test from "node:test";
import assert from "node:assert/strict";
import { createDb } from "../src/db.js";
import { runToolByName } from "../src/tool_runner.js";

function seedAssignment(db) {
  db.prepare(
    `
    INSERT INTO assignments (
      key, course, title, due_date, status, score, url, raw_text,
      first_seen_at, last_seen_at, last_missing_at, resolved_at, is_missing
    )
    VALUES (
      'a1', 'Algebra', 'Homework 1', '2026-03-15', 'Missing', '', '', '',
      '2026-02-20T00:00:00Z', '2026-02-20T00:00:00Z', '2026-02-20T00:00:00Z', NULL, 1
    )
  `
  ).run();
}

test("schedule_reminder infers recurring defaults when time and cadence are omitted", async () => {
  const db = createDb(":memory:");
  seedAssignment(db);

  const result = await runToolByName(
    db,
    "schedule_reminder",
    {
      key: "a1",
      remindAt: null,
      recurrence: null,
      message: "Check missing work",
    },
    {
      userText: "Set a recurring reminder to check missing work.",
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.recurrenceKind, "weekdays");
  assert.ok(result.remindAt);
  assert.ok(Array.isArray(result.assumptions));
  assert.equal(result.assumptions.length > 0, true);
});

test("create_task infers daily recurrence from frequency cue", async () => {
  const db = createDb(":memory:");
  const result = await runToolByName(
    db,
    "create_task",
    {
      title: "Check grades",
      remindAt: null,
      recurrence: null,
      message: "Review progress",
    },
    {
      userText: "Remind me every day to check grades.",
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.recurrenceKind, "daily");
  assert.ok(result.remindAt);
});

test("create_task applies weekly fallback for unsupported cadence", async () => {
  const db = createDb(":memory:");
  const result = await runToolByName(
    db,
    "create_task",
    {
      title: "Review grades",
      recurrence: "monthly",
      remindAt: null,
    },
    {
      userText: "Create a monthly reminder to review grades.",
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.recurrenceKind, "weekly");
  assert.ok(Array.isArray(result.warnings));
  assert.equal(result.warnings.length > 0, true);
});

test("create_task keeps date cue while applying default time and fallback warning", async () => {
  const db = createDb(":memory:");
  const result = await runToolByName(
    db,
    "create_task",
    {
      title: "Review Schoology grades",
      remindAt: "next Friday 4:30 PM",
      message: "Review Schoology grades and follow up on any missing/late work.",
      recurrence: "weekly",
      recurrenceTz: "America/New_York",
    },
    {
      userText: "Create a monthly reminder to review Schoology grades.",
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.recurrenceKind, "weekly");
  assert.ok(Array.isArray(result.warnings));
  assert.equal(
    result.warnings.some((warning) => String(warning || "").toLowerCase().includes("unsupported cadence")),
    true
  );

  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
  }).format(new Date(result.remindAt));
  assert.equal(weekday, "Fri");
});

test("create_task ignores model-supplied time when user gave no explicit time", async () => {
  const db = createDb(":memory:");
  const result = await runToolByName(
    db,
    "create_task",
    {
      title: "Check Schoology",
      remindAt: "4:30 PM",
      recurrence: "weekdays",
    },
    {
      userText: "Set a recurring reminder to check Schoology.",
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.recurrenceKind, "weekdays");
  assert.ok(Array.isArray(result.assumptions));
  assert.equal(result.assumptions.length > 0, true);
  const local = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(result.remindAt));
  assert.equal(local, "21:00");
});

test("non-frequency follow-up remains one-time", async () => {
  const db = createDb(":memory:");
  const result = await runToolByName(
    db,
    "create_task",
    {
      title: "Follow up with teacher",
      remindAt: "tomorrow at 4:30pm",
      recurrence: null,
    },
    {
      userText: "Remind me tomorrow at 4:30pm to follow up with my teacher.",
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.recurrenceKind, "none");
});
