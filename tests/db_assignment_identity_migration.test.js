import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { createDb, migrateDb, syncAssignmentsFromState } from "../src/db.js";

test("migration v6 backfills assignment_id and dedupes legacy/canonical rows", () => {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE assignments (
      key TEXT PRIMARY KEY,
      course TEXT,
      title TEXT,
      due_date TEXT,
      status TEXT,
      score TEXT,
      url TEXT,
      raw_text TEXT,
      first_seen_at TEXT,
      last_seen_at TEXT,
      last_missing_at TEXT,
      resolved_at TEXT,
      is_missing INTEGER NOT NULL DEFAULT 0,
      manual_status TEXT,
      manual_status_updated_at TEXT,
      auto_ignored INTEGER NOT NULL DEFAULT 0,
      auto_ignore_reason TEXT,
      auto_ignored_at TEXT
    );

    CREATE TABLE assignment_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      assignment_key TEXT NOT NULL,
      note TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      assignment_key TEXT,
      title TEXT NOT NULL,
      message TEXT,
      remind_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      kind TEXT NOT NULL DEFAULT 'personal',
      auto_cancel_on_resolve INTEGER NOT NULL DEFAULT 0,
      auto_planned INTEGER NOT NULL DEFAULT 0,
      recurrence_kind TEXT NOT NULL DEFAULT 'none',
      recurrence_tz TEXT,
      created_at TEXT NOT NULL,
      completed_at TEXT,
      last_sent_at TEXT,
      rolled_over_at TEXT,
      roll_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);
  db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (5, '2026-03-01T00:00:00Z')").run();

  db.prepare(
    `
    INSERT INTO assignments (
      key, course, title, due_date, status, score, url, raw_text,
      first_seen_at, last_seen_at, last_missing_at, resolved_at, is_missing,
      manual_status, manual_status_updated_at
    ) VALUES (
      'legacy-hash-key', 'Latin', 'Topic 3B',
      '2026-02-23', 'Missing', '', 'https://bcps.schoology.com/assignment/8267055411', '',
      '2026-02-23T10:00:00Z', '2026-03-01T10:00:00Z', '2026-03-01T10:00:00Z', NULL, 1,
      'No grade put in yet', '2026-03-01T10:15:00Z'
    )
  `
  ).run();

  db.prepare(
    `
    INSERT INTO assignments (
      key, course, title, due_date, status, score, url, raw_text,
      first_seen_at, last_seen_at, last_missing_at, resolved_at, is_missing
    ) VALUES (
      'assignment:8267055411', 'Latin', 'Topic 3B (Graded: 2/27)',
      '2026-02-23', 'Missing', '', 'https://bcps.schoology.com/assignment/8267055411', '',
      '2026-02-23T10:00:00Z', '2026-03-02T10:00:00Z', '2026-03-02T10:00:00Z', NULL, 1
    )
  `
  ).run();

  db.prepare(
    "INSERT INTO assignment_notes (assignment_key, note, created_at) VALUES ('legacy-hash-key', 'Teacher said retry', '2026-03-01T11:00:00Z')"
  ).run();
  db.prepare(
    `
    INSERT INTO tasks (
      assignment_key, title, message, remind_at, status, kind, created_at
    ) VALUES (
      'legacy-hash-key', 'Latin - Topic 3B', 'Follow up', '2026-03-04T13:00:00Z', 'pending', 'assignment', '2026-03-01T11:00:00Z'
    )
  `
  ).run();

  migrateDb(db);

  const rows = db
    .prepare("SELECT key, assignment_id AS assignmentId, manual_status AS manualStatus FROM assignments WHERE assignment_id = '8267055411'")
    .all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].key, "assignment:8267055411");
  assert.equal(rows[0].assignmentId, "8267055411");
  assert.equal(rows[0].manualStatus, "No grade put in yet");

  const note = db.prepare("SELECT assignment_key AS assignmentKey FROM assignment_notes LIMIT 1").get();
  assert.equal(note.assignmentKey, "assignment:8267055411");
  const task = db.prepare("SELECT assignment_key AS assignmentKey FROM tasks LIMIT 1").get();
  assert.equal(task.assignmentKey, "assignment:8267055411");
});

test("syncAssignmentsFromState writes canonical assignment key from assignment URL id", () => {
  const db = createDb();
  syncAssignmentsFromState(db, {
    assignments: {
      legacy_key: {
        key: "legacy_key",
        course: "Art",
        title: "Freezing a Moment in Time",
        dueDate: "2026-02-09",
        status: "Missing",
        score: "",
        url: "https://bcps.schoology.com/assignment/8253021749",
        rawText: "",
        firstSeenAt: "2026-03-01T11:00:00Z",
        lastSeenAt: "2026-03-02T11:00:00Z",
        lastMissingAt: "2026-03-02T11:00:00Z",
        resolvedAt: null,
        isMissing: true,
      },
    },
  });

  const row = db
    .prepare("SELECT key, assignment_id AS assignmentId FROM assignments WHERE assignment_id = '8253021749'")
    .get();
  assert.ok(row);
  assert.equal(row.key, "assignment:8253021749");
  assert.equal(row.assignmentId, "8253021749");
});
