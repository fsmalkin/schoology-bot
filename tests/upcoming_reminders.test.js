import { test } from "node:test";
import assert from "node:assert/strict";
import { createDb, listTasks } from "../src/db.js";
import { autoPlanUpcomingReminders } from "../src/tasks.js";

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
});
