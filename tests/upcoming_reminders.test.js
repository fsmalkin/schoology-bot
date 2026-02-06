import { test } from "node:test";
import assert from "node:assert/strict";
import { createDb, listTasks } from "../src/db.js";
import { autoPlanUpcomingReminders, rescheduleAutoPlannedReminders } from "../src/tasks.js";

test("autoPlanUpcomingReminders creates assignment task for upcoming due date", () => {
  const db = createDb(":memory:");
  db.prepare(
    `
    INSERT INTO assignments (key, course, title, due_date, status, is_missing, manual_status)
    VALUES (@key, @course, @title, @due_date, @status, @is_missing, @manual_status)
  `
  ).run({
    key: "b1",
    course: "Math",
    title: "Unit 1 Review",
    due_date: "2/06/26 11:59pm",
    status: "Assigned",
    is_missing: 0,
    manual_status: null,
  });

  const config = {
    schedule: { timezone: "America/New_York" },
    autoUpcoming: { enabled: true, days: 7, remindHour: 19, remindMinute: 0 },
  };

  autoPlanUpcomingReminders(db, config, "2026-02-05T12:00:00Z");

  const tasks = listTasks(db, { status: "pending" });
  assert.equal(tasks.length, 1);
  assert.ok(tasks[0].title.includes("Math"));
  assert.equal(tasks[0].remindAt, "2026-02-06T00:00:00.000Z");
  const flag = db.prepare("SELECT auto_planned AS autoPlanned FROM tasks").get();
  assert.equal(flag.autoPlanned, 1);
});

test("rescheduleAutoPlannedReminders updates wrong auto-planned times", () => {
  const db = createDb(":memory:");
  db.prepare(
    `
    INSERT INTO assignments (key, course, title, due_date, status, is_missing, manual_status)
    VALUES (@key, @course, @title, @due_date, @status, @is_missing, @manual_status)
  `
  ).run({
    key: "c1",
    course: "Science",
    title: "Lab 2",
    due_date: "2/06/26 11:59pm",
    status: "Assigned",
    is_missing: 0,
    manual_status: null,
  });

  db.prepare(
    `
    INSERT INTO tasks (assignment_key, title, message, remind_at, status, kind, auto_cancel_on_resolve, auto_planned, created_at)
    VALUES (@assignment_key, @title, @message, @remind_at, 'pending', 'assignment', 1, 1, @created_at)
  `
  ).run({
    assignment_key: "c1",
    title: "Science - Lab 2",
    message: "Auto reminder for upcoming due date (2/06/26 11:59pm).",
    remind_at: "2026-02-06T16:00:00.000Z",
    created_at: "2026-02-05T12:00:00.000Z",
  });

  const config = {
    schedule: { timezone: "America/New_York" },
    autoUpcoming: { enabled: true, days: 7, remindHour: 16, remindMinute: 0 },
  };

  const result = rescheduleAutoPlannedReminders(db, config, "2026-02-05T12:00:00Z");
  assert.equal(result.ok, true);
  assert.equal(result.updated, 1);

  const row = db.prepare("SELECT remind_at AS remindAt FROM tasks WHERE assignment_key = 'c1'").get();
  assert.equal(row.remindAt, "2026-02-05T21:00:00.000Z");
});

test("rescheduleAutoPlannedReminders falls back to due-day time if day-before is past", () => {
  const db = createDb(":memory:");
  db.prepare(
    `
    INSERT INTO assignments (key, course, title, due_date, status, is_missing, manual_status)
    VALUES (@key, @course, @title, @due_date, @status, @is_missing, @manual_status)
  `
  ).run({
    key: "d1",
    course: "History",
    title: "Chapter 3",
    due_date: "2/06/26 11:59pm",
    status: "Assigned",
    is_missing: 0,
    manual_status: null,
  });

  db.prepare(
    `
    INSERT INTO tasks (assignment_key, title, message, remind_at, status, kind, auto_cancel_on_resolve, auto_planned, created_at)
    VALUES (@assignment_key, @title, @message, @remind_at, 'pending', 'assignment', 1, 1, @created_at)
  `
  ).run({
    assignment_key: "d1",
    title: "History - Chapter 3",
    message: "Auto reminder for upcoming due date (2/06/26 11:59pm).",
    remind_at: "2026-02-06T16:00:00.000Z",
    created_at: "2026-02-06T15:00:00.000Z",
  });

  const config = {
    schedule: { timezone: "America/New_York" },
    autoUpcoming: { enabled: true, days: 7, remindHour: 16, remindMinute: 0 },
  };

  const result = rescheduleAutoPlannedReminders(db, config, "2026-02-06T17:00:00Z");
  assert.equal(result.ok, true);
  assert.equal(result.updated, 1);

  const row = db.prepare("SELECT remind_at AS remindAt FROM tasks WHERE assignment_key = 'd1'").get();
  assert.equal(row.remindAt, "2026-02-06T21:00:00.000Z");
});
