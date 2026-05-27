import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createDb,
  syncAssignmentsFromState,
  updateAssignmentStatus,
  applyNumberedStatuses,
  listAssignments,
  findAssignments,
  scheduleReminder,
} from "../src/db.js";

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

test("listAssignments hides ignored by default", () => {
  const db = createDb();
  seedDb(db);
  updateAssignmentStatus(db, { key: "a1", status: "A" });
  const list = listAssignments(db, { status: "missing" });
  assert.equal(list.length, 1);
  assert.equal(list[0].key, "a2");
});

test("listAssignments auto-ignores submitted items awaiting grade", () => {
  const db = createDb();
  seedDb(db);
  db.prepare("UPDATE assignments SET status = ?, raw_text = ? WHERE key = ?").run(
    "Missing",
    "This student has made a submission that has not been graded.",
    "a2"
  );

  const defaultList = listAssignments(db, { status: "missing" });
  assert.equal(defaultList.some((item) => item.key === "a2"), false);

  const withIgnored = listAssignments(db, { status: "missing", includeIgnored: true });
  const row = withIgnored.find((item) => item.key === "a2");
  assert.ok(row);
  assert.equal(row.statusCategory, "ignored");
  assert.equal(row.effectiveStatus, "Submitted, awaiting grade");
});

test("listAssignments can query submitted-awaiting-grade icon rows directly", () => {
  const db = createDb();
  seedDb(db);
  db.prepare(
    "UPDATE assignments SET status = ?, score = ?, raw_text = ?, is_missing = 0, resolved_at = ? WHERE key = ?"
  ).run(
    "Submitted, awaiting grade",
    "—",
    "Essay assignment — This student has made a submission that has not been graded.",
    "2026-01-03T00:00:00Z",
    "a2"
  );

  const defaultMissing = listAssignments(db, { status: "missing", includeIgnored: true });
  assert.equal(defaultMissing.some((item) => item.key === "a2"), false);

  const submitted = listAssignments(db, { status: "submitted_awaiting_grade" });
  assert.equal(submitted.length, 1);
  assert.equal(submitted[0].key, "a2");
  assert.equal(submitted[0].statusCategory, "ignored");
  assert.equal(submitted[0].effectiveStatus, "Submitted, awaiting grade");

  const alias = listAssignments(db, { status: "submitted-ungraded" });
  assert.equal(alias.length, 1);
  assert.equal(alias[0].key, "a2");
});

test("blank-title Schoology rows derive titles for lists and reminder flows", () => {
  const db = createDb();
  syncAssignmentsFromState(db, {
    assignments: {
      a1: {
        key: "a1",
        course: "Language Arts",
        title: "",
        dueDate: "2/11/26",
        status: "Missing, present during instruction.",
        score: "0",
        url: "",
        rawText:
          "L3: Figurative Language and Multiple ThemesNote: This material is not available within Schoology Due 2/11/260MissingComment: Missing, present during instruction.Offered/Received accommodation",
        firstSeenAt: "2026-03-14T10:00:00Z",
        lastSeenAt: "2026-03-14T10:00:00Z",
        lastMissingAt: "2026-03-14T10:00:00Z",
        resolvedAt: null,
        isMissing: true,
      },
    },
  });

  const list = listAssignments(db, { status: "missing", includeIgnored: true, includePending: true });
  assert.equal(list[0].title, "L3: Figurative Language and Multiple Themes");

  const matches = findAssignments(db, { title: "Figurative Language" });
  assert.equal(matches.length, 1);
  assert.equal(matches[0].title, "L3: Figurative Language and Multiple Themes");

  const reminder = scheduleReminder(db, {
    key: "a1",
    remindAt: "2026-03-14T16:00:00-04:00",
    message: "Follow up tomorrow",
  });
  assert.equal(reminder.ok, true);
  const task = db.prepare("SELECT title FROM tasks WHERE assignment_key = ?").get("a1");
  assert.equal(task.title, "Language Arts - L3: Figurative Language and Multiple Themes");
});
