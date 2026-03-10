import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDb } from "../src/db.js";
import {
  buildAssignmentDetail,
  buildAssignmentsWorkspace,
  buildDashboardMeta,
  buildHomeWorkspace,
  buildTasksWorkspace,
} from "../src/dashboard_workbench_data.js";

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
      ('a1', 'Algebra: Sec 1', 'Homework 1', '2/15/26 11:59pm', 'Missing', '', 'https://schoology.local/a1', '', '2026-02-10T00:00:00Z', '2026-02-16T00:00:00Z', '2026-02-16T00:00:00Z', NULL, 1, NULL, 0),
      ('a2', 'Latin: Sec 1', 'Quiz 1', '2/21/26 11:59pm', 'Missing', '', '', '', '2026-02-10T00:00:00Z', '2026-02-16T00:00:00Z', '2026-02-16T00:00:00Z', NULL, 1, 'Waiting on teacher', 0),
      ('a3', 'Science: Sec 1', 'Lab 1', '2/22/26 11:59pm', 'Missing', '', '', 'assignment submitted', '2026-02-10T00:00:00Z', '2026-02-16T00:00:00Z', '2026-02-16T00:00:00Z', NULL, 1, NULL, 0)
  `
  ).run();
  db.prepare(
    `
    INSERT INTO assignment_notes (assignment_key, note, created_at)
    VALUES
      ('a1', 'Check rubric before resubmitting', '2026-02-15T13:00:00Z'),
      ('a1', 'Teacher said to include graph work', '2026-02-16T14:00:00Z')
  `
  ).run();
  db.prepare(
    `
    INSERT INTO tasks (
      assignment_key, title, message, remind_at, status, kind, recurrence_kind, recurrence_tz, auto_cancel_on_resolve, auto_planned, created_at
    )
    VALUES
      ('a1', 'Algebra: Sec 1 - Homework 1', 'Bring calculator', '2026-02-16T21:00:00Z', 'pending', 'assignment', 'weekdays', 'America/New_York', 1, 0, '2026-02-14T00:00:00Z')
  `
  ).run();
}

function seedTasks(db) {
  db.prepare(
    `
    INSERT INTO tasks (
      assignment_key, title, message, remind_at, status, kind, recurrence_kind, recurrence_tz, auto_cancel_on_resolve, auto_planned, created_at
    )
    VALUES
      (NULL, 'Ask teacher', 'follow up', '2026-02-15T10:00:00Z', 'pending', 'personal', 'none', NULL, 0, 0, '2026-02-10T00:00:00Z'),
      (NULL, 'Read chapter', 'today', '2026-02-16T16:00:00Z', 'pending', 'personal', 'daily', 'America/New_York', 0, 0, '2026-02-10T00:00:00Z'),
      (NULL, 'Weekend check-in', 'later this week', '2026-02-19T18:00:00Z', 'pending', 'personal', 'weekly', 'America/New_York', 0, 0, '2026-02-10T00:00:00Z'),
      (NULL, 'Archive notes', 'done task', '2026-02-14T09:00:00Z', 'done', 'personal', 'none', NULL, 0, 0, '2026-02-10T00:00:00Z'),
      ('a1', 'Assignment reminder should stay hidden from tasks', 'assignment only', '2026-02-17T16:00:00Z', 'pending', 'assignment', 'none', NULL, 1, 0, '2026-02-10T00:00:00Z')
  `
  ).run();
}

test("buildDashboardMeta advertises parent-first views and quick actions", () => {
  const config = makeConfig(os.tmpdir());
  const meta = buildDashboardMeta({ config });
  assert.equal(meta.primaryViews[0].id, "home");
  assert.equal(meta.primaryViews[1].id, "schoolwork");
  assert.equal(meta.utilityViews[0].id, "admin");
  assert.ok(meta.quickActions.some((action) => action.id === "submitted"));
  assert.ok(meta.manualStatuses.some((option) => option.code === "D" && option.label === "Grade not posted yet"));
});

test("buildHomeWorkspace classifies items into tonight, coming up, waiting, and handled", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "schoology-home-workspace-"));
  try {
    const config = makeConfig(tempDir);
    const db = createDb(":memory:");
    seedAssignments(db);
    seedTasks(db);

    const payload = buildHomeWorkspace({
      config,
      dbOverride: db,
      now: new Date("2026-02-16T17:00:00Z"),
    });

    assert.equal(payload.summary.tonightCount, 3);
    assert.equal(payload.summary.waitingCount, 2);
    assert.equal(payload.summary.handledCount, 1);
    assert.ok(payload.sections.tonight.rows.some((row) => row.kind === "assignment" && row.key === "a1"));
    assert.ok(payload.sections.waiting.rows.some((row) => row.key === "a2"));
    assert.ok(payload.sections.waiting.rows.some((row) => row.key === "a3"));
    assert.ok(payload.sections.comingUp.rows.some((row) => row.kind === "task" && row.title === "Weekend check-in"));
    assert.ok(payload.sections.handled.rows.some((row) => row.kind === "task" && row.title === "Archive notes"));
    assert.equal(payload.summary.nextReminder.title, "Ask teacher");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("buildAssignmentsWorkspace includes parent-friendly status labels and reminder previews", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "schoology-schoolwork-assignments-"));
  try {
    const config = makeConfig(tempDir);
    const db = createDb(":memory:");
    seedAssignments(db);

    const payload = buildAssignmentsWorkspace({
      config,
      query: { status: "missing", includePending: "true", includeIgnored: "true" },
      dbOverride: db,
      now: new Date("2026-02-16T17:00:00Z"),
    });

    assert.equal(payload.summary.actionable, 1);
    assert.equal(payload.summary.waiting, 2);
    assert.equal(payload.summary.handled, 0);

    const row = payload.rows.find((entry) => entry.key === "a1");
    assert.ok(row);
    assert.equal(row.bucketLabel, "Needs attention");
    assert.equal(row.notesPreview.length, 2);
    assert.equal(row.pendingReminderCount, 1);
    assert.equal(row.nextReminder.recurrenceLabel, "Weekdays");
    assert.match(row.nextReminder.remindAtLabel, /(EST|EDT)/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("buildAssignmentDetail returns full note and reminder detail with parent-facing labels", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "schoology-assignment-detail-"));
  try {
    const config = makeConfig(tempDir);
    const db = createDb(":memory:");
    seedAssignments(db);

    const detail = buildAssignmentDetail({
      config,
      key: "a1",
      dbOverride: db,
      now: new Date("2026-02-16T17:00:00Z"),
    });

    assert.ok(detail);
    assert.equal(detail.notes.length, 2);
    assert.equal(detail.pendingReminder.id > 0, true);
    assert.equal(detail.assignment.bucketLabel, "Needs attention");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("buildTasksWorkspace excludes assignment-linked reminders", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "schoology-followups-workspace-"));
  try {
    const config = makeConfig(tempDir);
    const db = createDb(":memory:");
    seedTasks(db);

    const payload = buildTasksWorkspace({
      config,
      query: { status: "all" },
      dbOverride: db,
      now: new Date("2026-02-16T17:00:00Z"),
    });

    assert.equal(payload.rows.length, 4);
    assert.equal(payload.summary.pending, 3);
    assert.equal(payload.summary.done, 1);
    assert.ok(payload.rows.every((row) => !row.assignmentKey));
    assert.ok(payload.rows.some((row) => row.recurrenceLabel === "Daily"));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
