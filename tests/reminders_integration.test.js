import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDb, createTask, listTasks, closeDb } from "../src/db.js";
import { runReminders } from "../src/tasks.js";

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "schoology-reminders-"));
}

function makeConfig(tempDir) {
  return {
    schedule: {
      timezone: "America/New_York",
      scrapeCron: "0 6 * * *",
      sendCron: "0 7 * * *",
      reminderCron: "*/1 * * * *",
    },
    telegram: {
      botToken: "test-token",
      chatIds: ["123"],
    },
    paths: {
      dataDir: tempDir,
      agentDbPath: path.join(tempDir, "agent.db"),
      statePath: path.join(tempDir, "state.json"),
    },
  };
}

test("runReminders sends due tasks and rolls over", async () => {
  const tempDir = makeTempDir();
  const config = makeConfig(tempDir);
  try {
    const db = createDb(config.paths.agentDbPath);
    const created = createTask(db, { title: "Email teacher", remindAt: "2026-02-06T21:00:00Z" });
    db.close();

    let sent = 0;
    let messageText = "";
    await runReminders({
      config,
      nowOverride: "2026-02-06T22:00:00Z",
      senders: {
        telegramRaw: async (_cfg, text) => {
          sent += 1;
          messageText = text;
        },
      },
    });

    const db2 = createDb(config.paths.agentDbPath);
    const tasks = listTasks(db2, { status: "pending" });
    db2.close();

    assert.equal(sent, 1);
    assert.match(messageText, /^Do Now/m);
    assert.match(messageText, /\|/);
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].rollCount, 1);
    assert.equal(tasks[0].remindAt, "2026-02-07T21:00:00.000Z");
  } finally {
    closeDb();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("runReminders completes resolved assignment reminders before delivery and leaves pending manual statuses alone", async () => {
  const tempDir = makeTempDir();
  const config = makeConfig(tempDir);
  try {
    const db = createDb(config.paths.agentDbPath);
    const insertAssignment = db.prepare(
      `
      INSERT INTO assignments (
        key, course, title, due_date, status, score, url, raw_text,
        first_seen_at, last_seen_at, last_missing_at, resolved_at, is_missing,
        manual_status, auto_ignored, auto_ignore_reason, auto_ignored_at
      ) VALUES (
        @key, @course, @title, @due_date, @status, @score, @url, @raw_text,
        @first_seen_at, @last_seen_at, @last_missing_at, @resolved_at, @is_missing,
        @manual_status, @auto_ignored, @auto_ignore_reason, @auto_ignored_at
      )
    `
    );
    const insertTask = db.prepare(
      `
      INSERT INTO tasks (
        assignment_key, title, message, remind_at, status, kind,
        auto_cancel_on_resolve, auto_planned, recurrence_kind, recurrence_tz, created_at
      ) VALUES (
        @assignment_key, @title, @message, @remind_at, 'pending', 'assignment',
        1, 0, 'none', NULL, @created_at
      )
    `
    );

    const assignments = [
      {
        key: "resolved",
        course: "Algebra",
        title: "Resolved work",
        due_date: "2026-02-06",
        status: "Submitted",
        score: "10/10",
        raw_text: "",
        first_seen_at: "2026-02-06T20:00:00Z",
        last_seen_at: "2026-02-06T20:00:00Z",
        last_missing_at: "2026-02-06T20:00:00Z",
        resolved_at: "2026-02-06T20:15:00Z",
        is_missing: 0,
        manual_status: null,
        auto_ignored: 0,
        auto_ignore_reason: null,
        auto_ignored_at: null,
      },
      {
        key: "ignored",
        course: "Science",
        title: "Auto ignored work",
        due_date: "2026-02-06",
        status: "Missing",
        score: "",
        raw_text: "",
        first_seen_at: "2026-02-06T20:00:00Z",
        last_seen_at: "2026-02-06T20:00:00Z",
        last_missing_at: "2026-02-06T20:00:00Z",
        resolved_at: null,
        is_missing: 1,
        manual_status: null,
        auto_ignored: 1,
        auto_ignore_reason: "Past grading period (auto)",
        auto_ignored_at: "2026-02-06T20:10:00Z",
      },
      {
        key: "submitted",
        course: "Latin",
        title: "Submitted awaiting grade",
        due_date: "2026-02-06",
        status: "Missing",
        score: "",
        raw_text: "This student has made a submission that has not been graded.",
        first_seen_at: "2026-02-06T20:00:00Z",
        last_seen_at: "2026-02-06T20:00:00Z",
        last_missing_at: "2026-02-06T20:00:00Z",
        resolved_at: null,
        is_missing: 1,
        manual_status: null,
        auto_ignored: 0,
        auto_ignore_reason: null,
        auto_ignored_at: null,
      },
      {
        key: "waiting",
        course: "History",
        title: "Waiting on teacher work",
        due_date: "2026-02-06",
        status: "Missing",
        score: "",
        raw_text: "",
        first_seen_at: "2026-02-06T20:00:00Z",
        last_seen_at: "2026-02-06T20:00:00Z",
        last_missing_at: "2026-02-06T20:00:00Z",
        resolved_at: null,
        is_missing: 1,
        manual_status: "Waiting on teacher",
        auto_ignored: 0,
        auto_ignore_reason: null,
        auto_ignored_at: null,
      },
    ];

    for (const assignment of assignments) {
      insertAssignment.run({
        ...assignment,
        url: "",
      });
      insertTask.run({
        assignment_key: assignment.key,
        title: `${assignment.course} - ${assignment.title}`,
        message: "Follow up",
        remind_at: "2026-02-06T21:00:00Z",
        created_at: "2026-02-06T20:00:00Z",
      });
    }

    const sent = [];
    await runReminders({
      config,
      dbOverride: db,
      nowOverride: "2026-02-06T22:00:00Z",
      senders: {
        telegramRaw: async (_cfg, text) => {
          sent.push(text);
        },
      },
    });

    assert.equal(sent.length, 1);
    assert.match(sent[0], /Waiting on teacher work/);

    const rows = db
      .prepare(
        `
        SELECT
          assignment_key AS assignmentKey,
          status,
          remind_at AS remindAt,
          completed_at AS completedAt,
          roll_count AS rollCount
        FROM tasks
        ORDER BY assignment_key
      `
      )
      .all();

    assert.deepEqual(
      rows.map((row) => ({
        assignmentKey: row.assignmentKey,
        status: row.status,
        remindAt: row.remindAt,
        completedAt: row.completedAt,
        rollCount: row.rollCount,
      })),
      [
        {
          assignmentKey: "ignored",
          status: "done",
          remindAt: "2026-02-06T21:00:00Z",
          completedAt: "2026-02-06T22:00:00Z",
          rollCount: 0,
        },
        {
          assignmentKey: "resolved",
          status: "done",
          remindAt: "2026-02-06T21:00:00Z",
          completedAt: "2026-02-06T22:00:00Z",
          rollCount: 0,
        },
        {
          assignmentKey: "submitted",
          status: "done",
          remindAt: "2026-02-06T21:00:00Z",
          completedAt: "2026-02-06T22:00:00Z",
          rollCount: 0,
        },
        {
          assignmentKey: "waiting",
          status: "pending",
          remindAt: "2026-02-07T21:00:00.000Z",
          completedAt: null,
          rollCount: 1,
        },
      ]
    );
  } finally {
    try {
      db.close();
    } catch {
      // ignore
    }
    closeDb();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore temp cleanup failures on Windows
    }
  }
});
