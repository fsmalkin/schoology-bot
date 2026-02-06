import test from "node:test";
import assert from "node:assert/strict";
import { createDb, createTask } from "../src/db.js";
import { runToolByName } from "../src/tool_runner.js";

function newDb() {
  return createDb(":memory:");
}

test("list_tasks returns Eastern reminder labels", async () => {
  const db = newDb();
  createTask(db, { title: "Follow up", remindAt: "2026-02-06T21:00:00Z" });

  const result = await runToolByName(db, "list_tasks", { status: "pending" });
  assert.equal(result.ok, true);
  assert.equal(result.timeZone, "America/New_York");
  assert.equal(result.tasks.length, 1);

  const task = result.tasks[0];
  assert.equal(task.remindAtLocal, "2026-02-06 16:00");
  assert.equal(task.remindAt, "2026-02-06T16:00:00-05:00");
  assert.equal(task.remindAtUtc, "2026-02-06T21:00:00Z");
  assert.match(task.remindAtLabel, /(EST|EDT)/);
});

test("update_task returns Eastern reminder labels", async () => {
  const db = newDb();
  const created = createTask(db, { title: "Check notes", remindAt: "2026-02-06T21:00:00Z" });

  const updated = await runToolByName(db, "update_task", {
    id: created.id,
    remindAt: "2026-02-07T21:00:00Z",
  });
  assert.equal(updated.ok, true);
  assert.equal(updated.task.remindAtLocal, "2026-02-07 16:00");
  assert.equal(updated.task.remindAt, "2026-02-07T16:00:00-05:00");
  assert.equal(updated.task.remindAtUtc, "2026-02-07T21:00:00Z");
  assert.match(updated.task.remindAtLabel, /(EST|EDT)/);
});
