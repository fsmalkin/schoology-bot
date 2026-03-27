import test from "node:test";
import assert from "node:assert/strict";
import {
  completeResolvedAssignmentReminders,
  createDb,
  getChatMemory,
  getChatState,
  setChatMessageStyle,
  syncAssignmentsFromState,
  upsertChatMemory,
} from "../src/db.js";

test("chat memory and message style persist per chat", () => {
  const db = createDb();

  const initial = getChatState(db, "chat-1");
  assert.equal(initial.messageStyle, "compact");
  assert.equal(initial.turnCount, 0);

  const setStyle = setChatMessageStyle(db, "chat-1", "plain_language", {
    updatedAt: "2026-03-23T12:00:00Z",
  });
  assert.equal(setStyle.ok, true);

  const updated = getChatState(db, "chat-1");
  assert.equal(updated.messageStyle, "plain_language");

  const stored = upsertChatMemory(db, {
    chatId: "chat-1",
    summaryText: "Parent prefers plain language and short reminders.",
    sourceResponseId: "resp_123",
    updatedAt: "2026-03-23T12:05:00Z",
  });
  assert.equal(stored.ok, true);

  const memory = getChatMemory(db, "chat-1");
  assert.equal(memory.summaryText, "Parent prefers plain language and short reminders.");
  assert.equal(memory.sourceResponseId, "resp_123");
  assert.equal(memory.updatedAt, "2026-03-23T12:05:00Z");
});

test("resolved reminder cleanup completes resolved, auto-ignored, and submitted-awaiting-grade assignment reminders only", () => {
  const db = createDb();

  syncAssignmentsFromState(db, {
    assignments: {
      a1: {
        key: "a1",
        course: "Algebra",
        title: "Resolved assignment",
        dueDate: "2026-03-20",
        status: "Submitted",
        score: "10/10",
        url: "",
        rawText: "",
        firstSeenAt: "2026-03-20T10:00:00Z",
        lastSeenAt: "2026-03-21T10:00:00Z",
        lastMissingAt: "2026-03-20T10:00:00Z",
        resolvedAt: "2026-03-21T10:00:00Z",
        isMissing: false,
      },
      a2: {
        key: "a2",
        course: "Science",
        title: "Auto ignored assignment",
        dueDate: "2026-03-20",
        status: "Missing",
        score: "",
        url: "",
        rawText: "",
        firstSeenAt: "2026-03-20T10:00:00Z",
        lastSeenAt: "2026-03-21T10:00:00Z",
        lastMissingAt: "2026-03-21T10:00:00Z",
        resolvedAt: null,
        isMissing: true,
      },
      a3: {
        key: "a3",
        course: "Latin",
        title: "Submitted awaiting grade",
        dueDate: "2026-03-20",
        status: "Missing",
        score: "",
        url: "",
        rawText: "This student has made a submission that has not been graded.",
        firstSeenAt: "2026-03-20T10:00:00Z",
        lastSeenAt: "2026-03-21T10:00:00Z",
        lastMissingAt: "2026-03-21T10:00:00Z",
        resolvedAt: null,
        isMissing: true,
      },
      a4: {
        key: "a4",
        course: "History",
        title: "Waiting on teacher only",
        dueDate: "2026-03-20",
        status: "Missing",
        score: "",
        url: "",
        rawText: "",
        firstSeenAt: "2026-03-20T10:00:00Z",
        lastSeenAt: "2026-03-21T10:00:00Z",
        lastMissingAt: "2026-03-21T10:00:00Z",
        resolvedAt: null,
        isMissing: true,
      },
    },
  });

  db.prepare("UPDATE assignments SET auto_ignored = 1, auto_ignore_reason = 'test' WHERE key = 'a2'").run();
  db.prepare("UPDATE assignments SET manual_status = 'Waiting on teacher' WHERE key = 'a4'").run();

  const insertTask = db.prepare(`
    INSERT INTO tasks (
      assignment_key,
      title,
      message,
      remind_at,
      status,
      kind,
      auto_cancel_on_resolve,
      auto_planned,
      recurrence_kind,
      recurrence_tz,
      created_at
    ) VALUES (
      @assignment_key,
      @title,
      @message,
      @remind_at,
      'pending',
      'assignment',
      1,
      0,
      'none',
      NULL,
      @created_at
    )
  `);

  for (const key of ["a1", "a2", "a3", "a4"]) {
    insertTask.run({
      assignment_key: key,
      title: `${key} reminder`,
      message: "Follow up",
      remind_at: "2026-03-23T16:00:00Z",
      created_at: "2026-03-23T10:00:00Z",
    });
  }

  const result = completeResolvedAssignmentReminders(db, {
    completedAt: "2026-03-23T12:10:00Z",
  });

  assert.equal(result.ok, true);
  assert.equal(result.completed, 3);

  const rows = db
    .prepare("SELECT assignment_key AS assignmentKey, status, completed_at AS completedAt FROM tasks ORDER BY assignment_key")
    .all();
  assert.deepEqual(
    rows.map((row) => ({
      assignmentKey: row.assignmentKey,
      status: row.status,
      completedAt: row.completedAt,
    })),
    [
      { assignmentKey: "a1", status: "done", completedAt: "2026-03-23T12:10:00Z" },
      { assignmentKey: "a2", status: "done", completedAt: "2026-03-23T12:10:00Z" },
      { assignmentKey: "a3", status: "done", completedAt: "2026-03-23T12:10:00Z" },
      { assignmentKey: "a4", status: "pending", completedAt: null },
    ]
  );
});
