import test from "node:test";
import assert from "node:assert/strict";
import { createDb, syncAssignmentsFromState, addAssignmentNote } from "../src/db.js";
import { buildDbSummary } from "../src/summary.js";

test("buildDbSummary respects ignored and pending statuses", () => {
  const db = createDb(":memory:");
  const state = {
    assignments: {
      a1: {
        key: "a1",
        course: "Algebra",
        title: "HW 1",
        dueDate: "2026-01-01",
        status: "Missing",
        score: "",
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
        course: "Latin",
        title: "Quiz",
        dueDate: "2026-01-02",
        status: "Missing",
        score: "",
        url: "",
        rawText: "",
        firstSeenAt: "2026-01-01T00:00:00Z",
        lastSeenAt: "2026-01-02T00:00:00Z",
        lastMissingAt: "2026-01-02T00:00:00Z",
        resolvedAt: null,
        isMissing: true,
      },
      a3: {
        key: "a3",
        course: "Science",
        title: "Lab",
        dueDate: "2026-01-03",
        status: "Missing",
        score: "",
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

  db.prepare("UPDATE assignments SET manual_status = ? WHERE key = ?").run("Practice / not for grade", "a1");
  db.prepare("UPDATE assignments SET manual_status = ? WHERE key = ?").run("No grade put in yet", "a2");
  addAssignmentNote(db, { key: "a3", note: "Meet teacher tomorrow" });

  const summary = buildDbSummary(db, { includePending: true, includeIgnored: false });
  const titlesActionable = summary.actionable.map((row) => row.title);
  const titlesPending = summary.pending.map((row) => row.title);

  assert.ok(!titlesActionable.includes("HW 1"), "Ignored items should be filtered out");
  assert.ok(titlesPending.includes("Quiz"), "Pending item should be included");
  assert.ok(titlesActionable.includes("Lab"), "Actionable item should be included");
  const lab = summary.actionable.find((row) => row.title === "Lab");
  assert.ok(lab.notes && lab.notes.length === 1);
  assert.equal(lab.notes[0].note, "Meet teacher tomorrow");
});

test("buildDbSummary includes local due categories", () => {
  const db = createDb(":memory:");
  const state = {
    assignments: {
      past: {
        key: "past",
        course: "Science",
        title: "Past Lab",
        dueDate: "5/31/26 11:59pm",
        status: "Missing",
        score: "",
        url: "",
        rawText: "",
        firstSeenAt: "2026-06-01T00:00:00Z",
        lastSeenAt: "2026-06-01T00:00:00Z",
        lastMissingAt: "2026-06-01T00:00:00Z",
        resolvedAt: null,
        isMissing: true,
      },
      future: {
        key: "future",
        course: "Language Arts",
        title: "Future Essay",
        dueDate: "6/02/26 11:59pm",
        status: "Missing",
        score: "",
        url: "",
        rawText: "",
        firstSeenAt: "2026-06-01T00:00:00Z",
        lastSeenAt: "2026-06-01T00:00:00Z",
        lastMissingAt: "2026-06-01T00:00:00Z",
        resolvedAt: null,
        isMissing: true,
      },
    },
  };
  syncAssignmentsFromState(db, state);

  const summary = buildDbSummary(db, {
    includePending: true,
    includeIgnored: false,
    timeZone: "America/New_York",
    now: new Date("2026-06-01T12:00:00-04:00"),
  });

  assert.equal(summary.actionable.find((row) => row.key === "past")?.dueCategory, "overdue");
  assert.equal(summary.actionable.find((row) => row.key === "future")?.dueCategory, "upcoming");
});

test("buildDbSummary keeps exact submitted missing rows out of Do Now", () => {
  const db = createDb(":memory:");
  syncAssignmentsFromState(db, {
    assignments: {
      magley: {
        key: "magley",
        course: "Science MS7 GT/AA",
        title: "Lab: MAGLEY Review",
        dueDate: "5/11/26 11:59pm",
        status: "Submitted",
        score: "",
        url: "https://bcps.schoology.com/assignment/8386979006",
        rawText: "",
        firstSeenAt: "2026-06-02T10:00:00Z",
        lastSeenAt: "2026-06-02T10:00:00Z",
        lastMissingAt: "2026-06-02T10:00:00Z",
        resolvedAt: null,
        isMissing: true,
      },
      superhero: {
        key: "superhero",
        course: "Science MS7 GT/AA",
        title: "Unit 4: CE Superhero Story (Turn-in)",
        dueDate: "5/26/26 11:59pm",
        status: "Missing",
        score: "",
        url: "",
        rawText: "",
        firstSeenAt: "2026-06-02T10:00:00Z",
        lastSeenAt: "2026-06-02T10:00:00Z",
        lastMissingAt: "2026-06-02T10:00:00Z",
        resolvedAt: null,
        isMissing: true,
      },
    },
  });

  const summary = buildDbSummary(db, {
    includePending: true,
    includeIgnored: false,
    timeZone: "America/New_York",
    now: new Date("2026-06-02T07:00:00-04:00"),
  });

  assert.equal(summary.actionable.some((row) => row.key === "magley"), false);
  assert.equal(summary.pending.some((row) => row.key === "magley"), false);
  assert.equal(summary.actionable.find((row) => row.key === "superhero")?.dueCategory, "overdue");
});

test("addAssignmentNote rejects unknown assignment key", () => {
  const db = createDb(":memory:");
  const result = addAssignmentNote(db, { key: "missing", note: "Test note" });
  assert.equal(result.ok, false);
  assert.match(result.error || "", /not found/i);
});
