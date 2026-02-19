import test from "node:test";
import assert from "node:assert/strict";
import { cancelInactiveAssignmentTasks, createDb } from "../src/db.js";

function seedAssignments(db) {
  db.prepare(
    `
    INSERT INTO assignments (key, course, title, status, raw_text, is_missing, resolved_at, auto_ignored)
    VALUES
      ('a-resolved', 'Algebra', 'Resolved Item', 'Missing', '', 0, '2026-02-17T00:00:00Z', 0),
      ('a-ignored', 'Science', 'Ignored Item', 'Missing', '', 1, '', 1),
      ('a-submitted', 'Latin', 'Submitted Item', 'Submitted, awaiting grade', 'assignment submitted', 1, '', 0),
      ('a-active', 'Math', 'Active Item', 'Missing', '', 1, '', 0)
  `
  ).run();
}

function seedTasks(db) {
  db.prepare(
    `
    INSERT INTO tasks (assignment_key, title, message, remind_at, status, kind, auto_cancel_on_resolve, auto_planned, created_at)
    VALUES
      ('a-resolved', 'Resolved reminder', 'r1', '2026-02-18T15:00:00Z', 'pending', 'assignment', 1, 0, '2026-02-18T12:00:00Z'),
      ('a-ignored', 'Ignored reminder', 'r2', '2026-02-18T15:00:00Z', 'pending', 'assignment', 1, 0, '2026-02-18T12:00:00Z'),
      ('a-submitted', 'Submitted reminder', 'r3', '2026-02-18T15:00:00Z', 'pending', 'assignment', 1, 0, '2026-02-18T12:00:00Z'),
      ('a-active', 'Active reminder', 'r4', '2026-02-18T15:00:00Z', 'pending', 'assignment', 1, 0, '2026-02-18T12:00:00Z'),
      ('a-resolved', 'Manual keep reminder', 'r5', '2026-02-18T15:00:00Z', 'pending', 'assignment', 0, 0, '2026-02-18T12:00:00Z'),
      (NULL, 'Personal task', 'r6', '2026-02-18T15:00:00Z', 'pending', 'personal', 1, 0, '2026-02-18T12:00:00Z')
  `
  ).run();
}

test("cancelInactiveAssignmentTasks cancels only inactive assignment reminders", () => {
  const db = createDb(":memory:");
  seedAssignments(db);
  seedTasks(db);

  const result = cancelInactiveAssignmentTasks(db, { now: "2026-02-18T16:00:00Z" });
  assert.equal(result.ok, true);
  assert.equal(result.canceled, 3);
  assert.equal(result.byReason.resolved, 1);
  assert.equal(result.byReason.auto_ignored, 1);
  assert.equal(result.byReason.submitted_awaiting_grade, 1);

  const rows = db
    .prepare("SELECT title, status, completed_at AS completedAt FROM tasks ORDER BY id")
    .all();
  const byTitle = Object.fromEntries(rows.map((row) => [row.title, row]));

  assert.equal(byTitle["Resolved reminder"].status, "done");
  assert.equal(byTitle["Ignored reminder"].status, "done");
  assert.equal(byTitle["Submitted reminder"].status, "done");
  assert.equal(byTitle["Active reminder"].status, "pending");
  assert.equal(byTitle["Manual keep reminder"].status, "pending");
  assert.equal(byTitle["Personal task"].status, "pending");
  assert.equal(byTitle["Resolved reminder"].completedAt, "2026-02-18T16:00:00Z");
});
