import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { migrateDb } from "../src/db.js";

test("db migrations add task columns and index", () => {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE chat_state (
      chat_id TEXT PRIMARY KEY,
      last_response_id TEXT,
      turn_count INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT
    );

    CREATE TABLE tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      message TEXT,
      remind_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      completed_at TEXT,
      last_sent_at TEXT,
      rolled_over_at TEXT,
      roll_count INTEGER NOT NULL DEFAULT 0
    );
  `);

  migrateDb(db);

  const columns = db.prepare("PRAGMA table_info(tasks)").all().map((row) => row.name);
  assert.ok(columns.includes("assignment_key"));
  assert.ok(columns.includes("kind"));
  assert.ok(columns.includes("auto_cancel_on_resolve"));
  assert.ok(columns.includes("recurrence_kind"));
  assert.ok(columns.includes("recurrence_tz"));

  const indexes = db.prepare("PRAGMA index_list(tasks)").all().map((row) => row.name);
  assert.ok(indexes.includes("idx_tasks_assignment"));
  assert.ok(indexes.includes("idx_tasks_kind_status"));

  const chatColumns = db.prepare("PRAGMA table_info(chat_state)").all().map((row) => row.name);
  assert.ok(chatColumns.includes("message_style"));

  const chatMemory = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'chat_memory'")
    .get();
  assert.ok(chatMemory);

  const managedAgentSessions = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'managed_agent_sessions'")
    .get();
  assert.ok(managedAgentSessions);

  const managedAgentEvents = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'managed_agent_events'")
    .get();
  assert.ok(managedAgentEvents);
});

test("db migrations move pending legacy reminders into assignment tasks", () => {
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
      is_missing INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      assignment_key TEXT,
      remind_at TEXT NOT NULL,
      message TEXT,
      created_at TEXT NOT NULL,
      sent_at TEXT
    );

    CREATE TABLE tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      assignment_key TEXT,
      title TEXT NOT NULL,
      message TEXT,
      remind_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      completed_at TEXT,
      last_sent_at TEXT,
      rolled_over_at TEXT,
      roll_count INTEGER NOT NULL DEFAULT 0
    );
  `);

  db.prepare(
    `
    INSERT INTO assignments (
      key, course, title, due_date, status, score, url, raw_text,
      first_seen_at, last_seen_at, last_missing_at, resolved_at, is_missing
    ) VALUES (
      'a1', 'Algebra', 'Homework 1', '2026-02-20', 'Missing', '', '', '',
      '2026-02-10T00:00:00Z', '2026-02-10T00:00:00Z', '2026-02-10T00:00:00Z', NULL, 1
    )
  `
  ).run();

  db.prepare(
    `
    INSERT INTO reminders (assignment_key, remind_at, message, created_at, sent_at)
    VALUES ('a1', '2026-02-21T14:00:00Z', 'legacy reminder', '2026-02-20T10:00:00Z', NULL)
  `
  ).run();

  migrateDb(db);

  const pendingLegacy = db.prepare("SELECT COUNT(*) AS count FROM reminders WHERE sent_at IS NULL").get();
  assert.equal(Number(pendingLegacy.count || 0), 0);

  const task = db
    .prepare(
      `
      SELECT
        assignment_key AS assignmentKey,
        kind,
        status,
        recurrence_kind AS recurrenceKind,
        recurrence_tz AS recurrenceTz,
        message
      FROM tasks
      WHERE assignment_key = 'a1'
    `
    )
    .get();

  assert.ok(task);
  assert.equal(task.assignmentKey, "a1");
  assert.equal(task.kind, "assignment");
  assert.equal(task.status, "pending");
  assert.equal(task.recurrenceKind, "none");
  assert.equal(task.recurrenceTz, null);
  assert.equal(task.message, "legacy reminder");
});
