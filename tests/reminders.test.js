import test from "node:test";
import assert from "node:assert/strict";
import { createDb, scheduleReminder, listReminders, updateReminder, deleteReminder, dedupePendingReminders } from "../src/db.js";

function seedAssignment(db) {
  db.prepare(
    `
    INSERT INTO assignments (key, course, title, due_date, status, score, url, raw_text, first_seen_at, last_seen_at, last_missing_at, resolved_at, is_missing)
    VALUES ('a1', 'Algebra', 'Homework 1', '2026-02-01', 'Missing', '', '', '', '2026-02-01T00:00:00Z', '2026-02-01T00:00:00Z', '2026-02-01T00:00:00Z', NULL, 1)
  `
  ).run();
}

test("scheduleReminder replaces existing pending reminders", () => {
  const db = createDb(":memory:");
  seedAssignment(db);

  const first = scheduleReminder(db, { key: "a1", remindAt: "2026-02-03T20:30:00Z", message: "first" });
  assert.equal(first.ok, true);

  const second = scheduleReminder(db, { key: "a1", remindAt: "2026-02-03T21:00:00Z", message: "second" });
  assert.equal(second.ok, true);
  assert.equal(second.replaced, true);

  const reminders = listReminders(db, { key: "a1", status: "pending" });
  assert.equal(reminders.length, 1);
  assert.equal(reminders[0].remindAt, "2026-02-03T21:00:00Z");
});

test("update and delete reminders", () => {
  const db = createDb(":memory:");
  seedAssignment(db);

  const created = scheduleReminder(db, { key: "a1", remindAt: "2026-02-03T20:30:00Z" });
  const update = updateReminder(db, { id: created.reminderId, remindAt: "2026-02-03T22:00:00Z" });
  assert.equal(update.ok, true);
  assert.equal(update.reminder.remindAt, "2026-02-03T22:00:00Z");

  const removed = deleteReminder(db, { id: created.reminderId });
  assert.equal(removed.ok, true);
});

test("dedupePendingReminders removes duplicates", () => {
  const db = createDb(":memory:");
  seedAssignment(db);

  scheduleReminder(db, { key: "a1", remindAt: "2026-02-03T20:30:00Z", replaceExisting: false });
  scheduleReminder(db, { key: "a1", remindAt: "2026-02-03T21:00:00Z", replaceExisting: false });
  scheduleReminder(db, { key: "a1", remindAt: "2026-02-03T22:00:00Z", replaceExisting: false });

  const cleanup = dedupePendingReminders(db);
  assert.equal(cleanup.ok, true);
  assert.equal(cleanup.removed, 2);

  const reminders = listReminders(db, { key: "a1", status: "pending" });
  assert.equal(reminders.length, 1);
});

test("scheduleReminder requires a valid reminder time", () => {
  const db = createDb(":memory:");
  seedAssignment(db);

  const missing = scheduleReminder(db, { key: "a1", remindAt: "" });
  assert.equal(missing.ok, false);
  assert.match(missing.error, /Reminder time is required/i);

  const invalid = scheduleReminder(db, { key: "a1", remindAt: "tomorrow at 4pl" });
  assert.equal(invalid.ok, false);
  assert.match(invalid.error, /Reminder time is invalid/i);
});

test("scheduleReminder rejects unknown assignment key", () => {
  const db = createDb(":memory:");
  const result = scheduleReminder(db, { key: "missing", remindAt: "2026-02-03T20:30:00Z" });
  assert.equal(result.ok, false);
  assert.match(result.error, /Assignment not found/i);
});
