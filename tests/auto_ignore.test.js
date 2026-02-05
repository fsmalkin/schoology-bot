import { test } from "node:test";
import assert from "node:assert/strict";
import { createDb, applyAutoIgnoreRules } from "../src/db.js";

test("applyAutoIgnoreRules marks old missing assignments", () => {
  const db = createDb(":memory:");
  db.prepare(
    `
    INSERT INTO assignments (key, course, title, due_date, status, is_missing, manual_status)
    VALUES (@key, @course, @title, @due_date, @status, @is_missing, @manual_status)
  `
  ).run({
    key: "a1",
    course: "Science",
    title: "Old practice work",
    due_date: "12/01/25 11:59pm",
    status: "Missing",
    is_missing: 1,
    manual_status: null,
  });

  const result = applyAutoIgnoreRules(db, {
    now: "2026-02-05T12:00:00Z",
    oldDays: 30,
    keywords: ["practice"],
  });
  assert.equal(result.ok, true);

  const row = db
    .prepare("SELECT auto_ignored AS autoIgnored, auto_ignore_reason AS reason FROM assignments WHERE key = ?")
    .get("a1");
  assert.equal(row.autoIgnored, 1);
  assert.ok(String(row.reason || "").length > 0);
});
