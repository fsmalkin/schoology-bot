import test from "node:test";
import assert from "node:assert/strict";
import {
  createDb,
  createTask,
  listTasks,
  updateTaskStatus,
  updateTask,
  deleteTask,
  listDueTasks,
  markTaskReminderSent,
} from "../src/db.js";
import { computeNextReminderTime } from "../src/tasks.js";

function newDb() {
  return createDb(":memory:");
}

test("tasks CRUD", () => {
  const db = newDb();
  const created = createTask(db, { title: "Ask a friend", remindAt: "2026-02-03T21:00:00Z" });
  assert.equal(created.ok, true);

  const all = listTasks(db, { status: "all" });
  assert.equal(all.length, 1);
  assert.equal(all[0].title, "Ask a friend");

  const updated = updateTask(db, {
    id: created.id,
    title: "Ask a friend to call",
    remindAt: "2026-02-04T21:00:00Z",
  });
  assert.equal(updated.ok, true);
  assert.equal(updated.task.title, "Ask a friend to call");

  const done = updateTaskStatus(db, { id: created.id, status: "done" });
  assert.equal(done.ok, true);
  assert.equal(done.task.status, "done");

  const removed = deleteTask(db, { id: created.id });
  assert.equal(removed.ok, true);
});

test("task reminders roll over", () => {
  const db = newDb();
  const created = createTask(db, { title: "Task", remindAt: "2026-02-03T21:00:00Z" });
  const due = listDueTasks(db, "2026-02-03T22:00:00Z");
  assert.equal(due.length, 1);
  const mark = markTaskReminderSent(db, {
    id: created.id,
    sentAt: "2026-02-03T22:00:00Z",
    nextRemindAt: "2026-02-04T21:00:00Z",
  });
  assert.equal(mark.ok, true);
  const after = listTasks(db, { status: "pending" });
  assert.equal(after[0].remindAt, "2026-02-04T21:00:00Z");
  assert.equal(after[0].rollCount, 1);
});

test("createTask requires a valid reminder time", () => {
  const db = newDb();
  const missing = createTask(db, { title: "Bad time", remindAt: "" });
  assert.equal(missing.ok, false);
  assert.match(missing.error, /Reminder time is required/i);

  const invalid = createTask(db, { title: "Bad time", remindAt: "tomorrow at 4pl" });
  assert.equal(invalid.ok, false);
  assert.match(invalid.error, /Reminder time is invalid/i);
});

test("tasks support recurrence fields", () => {
  const db = newDb();
  const created = createTask(db, {
    title: "Daily check",
    remindAt: "2026-03-02T12:00:00Z",
    recurrence: "daily",
    recurrenceTz: "America/New_York",
  });
  assert.equal(created.ok, true);
  assert.equal(created.recurrenceKind, "daily");
  assert.equal(created.recurrenceTz, "America/New_York");
  const row = listTasks(db, { status: "all" })[0];
  assert.equal(row.recurrenceKind, "daily");
  assert.equal(row.recurrenceTz, "America/New_York");
});

test("computeNextReminderTime skips weekends for weekday recurrence", () => {
  const task = {
    remindAt: "2026-03-06T14:00:00Z",
    recurrenceKind: "weekdays",
    recurrenceTz: "America/New_York",
  };
  const next = computeNextReminderTime(task, "America/New_York");
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
  }).format(next);
  assert.equal(weekday, "Mon");
});

test("computeNextReminderTime preserves wall-clock hour across DST for weekly recurrence", () => {
  const task = {
    remindAt: "2026-03-01T13:00:00Z",
    recurrenceKind: "weekly",
    recurrenceTz: "America/New_York",
  };
  const next = computeNextReminderTime(task, "America/New_York");
  const localHm = (value) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(value));
  assert.equal(localHm(task.remindAt), localHm(next.toISOString()));
});
