import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createDb,
  syncAssignmentsFromState,
  updateAssignmentStatus,
  updateAssignmentStatusesByFilter,
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

test("updateAssignmentStatus maps no-action wording to ignored status", () => {
  const db = createDb();
  seedDb(db);

  const result = updateAssignmentStatus(db, { key: "a1", status: "No action needed" });
  assert.equal(result.ok, true);
  const row = db.prepare("SELECT manual_status FROM assignments WHERE key = ?").get("a1");
  assert.equal(row.manual_status, "No way to fix it");
  assert.equal(listAssignments(db, { status: "missing" }).some((item) => item.key === "a1"), false);
});

test("updateAssignmentStatusesByFilter handles date-scoped no-action updates", () => {
  const db = createDb();
  syncAssignmentsFromState(db, {
    assignments: {
      oldActionable: {
        key: "oldActionable",
        course: "Science",
        title: "Old Missing",
        dueDate: "3/27/26 11:59pm",
        status: "Missing",
        isMissing: true,
      },
      oldPending: {
        key: "oldPending",
        course: "Chorus",
        title: "Old Waiting",
        dueDate: "2/10/26 11:59pm",
        status: "Missing",
        isMissing: true,
      },
      onCutoff: {
        key: "onCutoff",
        course: "Science",
        title: "Cutoff Missing",
        dueDate: "4/04/26 11:59pm",
        status: "Missing",
        isMissing: true,
      },
      resolvedOld: {
        key: "resolvedOld",
        course: "Science",
        title: "Resolved Old",
        dueDate: "3/01/26 11:59pm",
        status: "A 10 / 10",
        isMissing: false,
      },
    },
  });
  updateAssignmentStatus(db, { key: "oldPending", status: "E" });

  const result = updateAssignmentStatusesByFilter(
    db,
    {
      targetStatus: "No action needed",
      dueBefore: "2025-04-04",
      assignmentStatus: "missing",
      includePending: true,
      includeIgnored: false,
    },
    {
      now: "2026-05-28T12:00:00-04:00",
      timeZone: "America/New_York",
      userText: "mark everything before 4/4 as no action needed",
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.status, "No way to fix it");
  assert.equal(result.filter.dueBefore, "2026-04-04");
  assert.equal(result.matchedCount, 2);
  assert.equal(result.updatedCount, 2);
  assert.deepEqual(
    db
      .prepare("SELECT key, manual_status AS manualStatus FROM assignments ORDER BY key")
      .all(),
    [
      { key: "oldActionable", manualStatus: "No way to fix it" },
      { key: "oldPending", manualStatus: "No way to fix it" },
      { key: "onCutoff", manualStatus: null },
      { key: "resolvedOld", manualStatus: null },
    ]
  );
});

test("updateAssignmentStatusesByFilter enforces safety cap without writing", () => {
  const db = createDb();
  seedDb(db);
  db.prepare("UPDATE assignments SET due_date = ? WHERE key = ?").run("1/01/26 11:59pm", "a1");
  db.prepare("UPDATE assignments SET due_date = ? WHERE key = ?").run("1/02/26 11:59pm", "a2");

  const result = updateAssignmentStatusesByFilter(
    db,
    {
      targetStatus: "C",
      dueOnOrBefore: "2026-01-31",
      maxUpdates: 1,
    },
    { now: "2026-05-28T12:00:00-04:00", timeZone: "America/New_York" }
  );

  assert.equal(result.ok, false);
  assert.match(result.error, /above the safety limit/);
  const rows = db.prepare("SELECT manual_status FROM assignments").all();
  assert.ok(rows.every((row) => row.manual_status === null));
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

test("listAssignments bucketed output honors ignored and pending filters", () => {
  const db = createDb();
  seedDb(db);
  updateAssignmentStatus(db, { key: "a1", status: "No action needed" });
  updateAssignmentStatus(db, { key: "a2", status: "Waiting on teacher" });

  const defaultBuckets = listAssignments(db, {
    status: "missing",
    includeIgnored: false,
    includePending: true,
    bucketed: true,
  });
  assert.deepEqual(defaultBuckets.buckets.actionable.map((row) => row.key), []);
  assert.deepEqual(defaultBuckets.buckets.pending.map((row) => row.key), ["a2"]);
  assert.deepEqual(defaultBuckets.buckets.ignored.map((row) => row.key), []);
  assert.equal(defaultBuckets.total, 1);
  assert.equal(defaultBuckets.unfilteredTotal, 2);

  const hiddenPending = listAssignments(db, {
    status: "missing",
    includeIgnored: false,
    includePending: false,
    bucketed: true,
  });
  assert.deepEqual(hiddenPending.buckets.pending, []);
  assert.equal(hiddenPending.total, 0);

  const withIgnored = listAssignments(db, {
    status: "missing",
    includeIgnored: true,
    includePending: true,
    bucketed: true,
  });
  assert.deepEqual(withIgnored.buckets.ignored.map((row) => row.key), ["a1"]);
  assert.deepEqual(withIgnored.buckets.pending.map((row) => row.key), ["a2"]);
  assert.equal(withIgnored.total, 2);
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

test("listAssignments auto-ignores exact submitted rows that still appear missing", () => {
  const db = createDb();
  seedDb(db);
  db.prepare("UPDATE assignments SET status = ?, raw_text = ? WHERE key = ?").run(
    "Submitted",
    "",
    "a2"
  );

  const defaultList = listAssignments(db, { status: "missing" });
  assert.equal(defaultList.some((item) => item.key === "a2"), false);

  const withIgnored = listAssignments(db, { status: "missing", includeIgnored: true });
  const row = withIgnored.find((item) => item.key === "a2");
  assert.ok(row);
  assert.equal(row.statusCategory, "ignored");
  assert.equal(row.effectiveStatus, "Submitted");

  const submitted = listAssignments(db, { status: "submitted_awaiting_grade" });
  assert.equal(submitted.length, 1);
  assert.equal(submitted[0].key, "a2");
});

test("listAssignments does not treat Not Submitted as a submitted signal", () => {
  const db = createDb();
  seedDb(db);
  db.prepare("UPDATE assignments SET status = ?, raw_text = ? WHERE key = ?").run(
    "Not Submitted",
    "",
    "a2"
  );

  const defaultList = listAssignments(db, { status: "missing" });
  const row = defaultList.find((item) => item.key === "a2");
  assert.ok(row);
  assert.equal(row.statusCategory, "actionable");
  assert.equal(row.effectiveStatus, "Not Submitted");
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
