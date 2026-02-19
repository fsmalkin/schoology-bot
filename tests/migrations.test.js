import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { migrateDb } from "../src/db.js";

test("db migrations add task columns and index", () => {
  const db = new Database(":memory:");
  db.exec(`
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

  const indexes = db.prepare("PRAGMA index_list(tasks)").all().map((row) => row.name);
  assert.ok(indexes.includes("idx_tasks_assignment"));

  const chatMemoryTable = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='chat_memory'")
    .get();
  assert.ok(chatMemoryTable);
});
