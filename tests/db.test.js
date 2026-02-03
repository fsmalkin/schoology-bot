import { test } from "node:test";
import assert from "node:assert/strict";
import { createDb, syncAssignmentsFromState, updateAssignmentStatus, applyNumberedStatuses, listAssignments } from "../src/db.js";

function seedDb(db) {
  const state = {
    assignments: {
      a1: {
        key: "a1",
        course: "Algebra",
        title: "Homework 1",
        dueDate: "2026-01-01",
        status: "Missing",
        score: "0/10",
        url: "",
        rawText: "",
        firstSeenAt: "2026-01-01T00:00:00Z",
        lastSeenAt: "2026-01-02T00:00:00Z",
        lastMissingAt: "2026-01-02T00:00:00Z",
        resolvedAt: null,
        isMissing: true,
      },
      a2: {
        key: "a2",
        course: "Science",
        title: "Lab 1",
        dueDate: "2026-01-02",
        status: "Missing",
        score: "0/10",
        url: "",
        rawText: "",
        firstSeenAt: "2026-01-01T00:00:00Z",
        lastSeenAt: "2026-01-02T00:00:00Z",
        lastMissingAt: "2026-01-02T00:00:00Z",
        resolvedAt: null,
        isMissing: true,
      },
    },
  };
  syncAssignmentsFromState(db, state);
}

test("updateAssignmentStatus maps letter codes", () => {
  const db = createDb();
  seedDb(db);

  const result = updateAssignmentStatus(db, { key: "a1", status: "B" });
  assert.equal(result.ok, true);
  const row = db.prepare("SELECT manual_status FROM assignments WHERE key = ?").get("a1");
  assert.equal(row.manual_status, "Practice / not for grade");
});

test("applyNumberedStatuses updates by list index", () => {
  const db = createDb();
  seedDb(db);

  const list = listAssignments(db, { status: "missing" });
  assert.equal(list.length, 2);

  const result = applyNumberedStatuses(db, {
    statusByIndex: [
      { index: 1, status: "C" },
      { index: 2, status: "D" },
    ],
  });

  assert.equal(result.successCount, 2);
  const rows = db.prepare("SELECT key, manual_status FROM assignments ORDER BY key").all();
  assert.deepEqual(rows, [
    { key: "a1", manual_status: "No way to fix it" },
    { key: "a2", manual_status: "No grade put in yet" },
  ]);
});
