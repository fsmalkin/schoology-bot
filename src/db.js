import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { getManualStatusCategory, normalizeManualStatus, isIgnoredStatus, isPendingStatus } from "./statuses.js";
import { nowIso } from "./time.js";
import { loadState } from "./storage.js";

let dbInstance = null;

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function initDb(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS assignments (
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
      manual_status_updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS assignment_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      assignment_key TEXT NOT NULL,
      note TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (assignment_key) REFERENCES assignments(key)
    );

    CREATE TABLE IF NOT EXISTS reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      assignment_key TEXT,
      remind_at TEXT NOT NULL,
      message TEXT,
      created_at TEXT NOT NULL,
      sent_at TEXT,
      FOREIGN KEY (assignment_key) REFERENCES assignments(key)
    );

    CREATE TABLE IF NOT EXISTS tasks (
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

    CREATE TABLE IF NOT EXISTS chat_state (
      chat_id TEXT PRIMARY KEY,
      last_response_id TEXT,
      turn_count INTEGER NOT NULL DEFAULT 0,
      last_compact_at TEXT,
      updated_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_assignments_course ON assignments(course);
    CREATE INDEX IF NOT EXISTS idx_assignments_due_date ON assignments(due_date);
    CREATE INDEX IF NOT EXISTS idx_assignments_missing ON assignments(is_missing);
    CREATE INDEX IF NOT EXISTS idx_notes_assignment ON assignment_notes(assignment_key);
    CREATE INDEX IF NOT EXISTS idx_reminders_pending ON reminders(sent_at, remind_at);
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_remind_at ON tasks(remind_at);
  `);
}

export function createDb(dbPath = ":memory:") {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  initDb(db);
  return db;
}

export function getDb(config) {
  if (dbInstance) return dbInstance;
  const dbPath = config?.paths?.agentDbPath || path.join(process.cwd(), "data", "agent.db");
  ensureDir(path.dirname(dbPath));
  const db = createDb(dbPath);
  dbInstance = db;
  return dbInstance;
}

export function closeDb() {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

export function syncAssignmentsFromState(db, state) {
  if (!state?.assignments) return;
  const upsert = db.prepare(`
    INSERT INTO assignments (
      key, course, title, due_date, status, score, url, raw_text,
      first_seen_at, last_seen_at, last_missing_at, resolved_at, is_missing
    ) VALUES (
      @key, @course, @title, @due_date, @status, @score, @url, @raw_text,
      @first_seen_at, @last_seen_at, @last_missing_at, @resolved_at, @is_missing
    )
    ON CONFLICT(key) DO UPDATE SET
      course = excluded.course,
      title = excluded.title,
      due_date = excluded.due_date,
      status = excluded.status,
      score = excluded.score,
      url = excluded.url,
      raw_text = excluded.raw_text,
      last_seen_at = excluded.last_seen_at,
      last_missing_at = excluded.last_missing_at,
      resolved_at = excluded.resolved_at,
      is_missing = excluded.is_missing;
  `);

  const tx = db.transaction((items) => {
    for (const item of items) {
      upsert.run(item);
    }
  });

  const rows = Object.values(state.assignments).map((item) => ({
    key: item.key,
    course: item.course || "",
    title: item.title || "",
    due_date: item.dueDate || "",
    status: item.status || "",
    score: item.score || "",
    url: item.url || "",
    raw_text: item.rawText || "",
    first_seen_at: item.firstSeenAt || "",
    last_seen_at: item.lastSeenAt || "",
    last_missing_at: item.lastMissingAt || "",
    resolved_at: item.resolvedAt || "",
    is_missing: item.isMissing ? 1 : 0,
  }));

  tx(rows);
}

export function ensureDbSeeded(db, statePath) {
  const count = db.prepare("SELECT COUNT(*) AS count FROM assignments").get();
  if (count && count.count > 0) return;
  const state = loadState(statePath);
  syncAssignmentsFromState(db, state);
}

export function listAssignments(db, options = {}) {
  const status = (options.status || "missing").toLowerCase();
  const course = options.course ? String(options.course).toLowerCase() : null;
  const limit = Number.isFinite(options.limit) ? Math.max(1, Math.min(options.limit, 200)) : 50;
  const includeIgnored = options.includeIgnored === true;
  const includePending = options.includePending !== false;
  const bucketed = options.bucketed === true;

  const filters = [];
  const params = { limit };

  if (status === "missing") filters.push("is_missing = 1");
  if (status === "resolved") filters.push("is_missing = 0");
  if (course) {
    filters.push("LOWER(course) LIKE @course");
    params.course = `%${course}%`;
  }

  const where = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";

  const rows = db
    .prepare(
      `
      SELECT
        key,
        course,
        title,
        due_date AS dueDate,
        status,
        manual_status AS manualStatus,
        score,
        url,
        first_seen_at AS firstSeenAt,
        last_seen_at AS lastSeenAt,
        last_missing_at AS lastMissingAt,
        resolved_at AS resolvedAt,
        is_missing AS isMissing,
        (SELECT COUNT(*) FROM assignment_notes n WHERE n.assignment_key = assignments.key) AS notesCount
      FROM assignments
      ${where}
      ORDER BY LOWER(course), due_date, LOWER(title)
      LIMIT @limit
    `
    )
    .all(params);

  const mapped = rows.map((row) => {
    const manualStatus = row.manualStatus || "";
    const statusCategory = getManualStatusCategory(manualStatus);
    return {
    ...row,
    isMissing: row.isMissing === 1,
    effectiveStatus: manualStatus || row.status || "",
    statusCategory,
    };
  });

  const filtered = mapped.filter((row) => {
    if (!includeIgnored && isIgnoredStatus(row.manualStatus)) return false;
    if (!includePending && isPendingStatus(row.manualStatus)) return false;
    return true;
  });

  if (!bucketed) {
    return filtered;
  }

  const buckets = { actionable: [], pending: [], ignored: [] };
  for (const row of mapped) {
    if (row.statusCategory === "ignored") {
      buckets.ignored.push(row);
    } else if (row.statusCategory === "pending") {
      buckets.pending.push(row);
    } else {
      buckets.actionable.push(row);
    }
  }

  return { buckets, total: mapped.length, filteredTotal: filtered.length };
}

export function findAssignments(db, options = {}) {
  const title = options.title ? String(options.title).toLowerCase() : null;
  const course = options.course ? String(options.course).toLowerCase() : null;
  if (!title) return [];
  const params = { title: `%${title}%` };
  const filters = ["LOWER(title) LIKE @title"];
  if (course) {
    filters.push("LOWER(course) LIKE @course");
    params.course = `%${course}%`;
  }
  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  return db
    .prepare(
      `
      SELECT key, course, title, due_date AS dueDate, status, manual_status AS manualStatus
      FROM assignments
      ${where}
      ORDER BY LOWER(course), due_date, LOWER(title)
      LIMIT 20
    `
    )
    .all(params);
}

export function updateAssignmentStatus(db, { key, title, course, status }) {
  let targetKey = key || null;
  if (!targetKey && title) {
    const matches = findAssignments(db, { title, course });
    if (matches.length === 1) {
      targetKey = matches[0].key;
    } else if (matches.length === 0) {
      return { ok: false, error: "No matching assignments found.", matches: [] };
    } else {
      return { ok: false, error: "Multiple assignments match that title.", matches };
    }
  }

  if (!targetKey) {
    return { ok: false, error: "Assignment key or title is required." };
  }

  const normalizedStatus = normalizeManualStatus(status);
  const updated = db
    .prepare(
      `
      UPDATE assignments
      SET manual_status = @status,
          manual_status_updated_at = @updated_at
      WHERE key = @key
    `
    )
    .run({ status: normalizedStatus, updated_at: nowIso(), key: targetKey });

  if (updated.changes === 0) {
    return { ok: false, error: "Assignment not found." };
  }

  const assignment = db
    .prepare("SELECT course, title, due_date AS dueDate FROM assignments WHERE key = ?")
    .get(targetKey);

  return { ok: true, key: targetKey, status: normalizedStatus, assignment };
}

export function updateAssignmentStatuses(db, updates = []) {
  const results = [];
  let successCount = 0;
  for (const update of updates) {
    const result = updateAssignmentStatus(db, update || {});
    if (result.ok) successCount += 1;
    results.push({ input: update, result });
  }
  return { ok: true, successCount, total: results.length, results };
}

export function applyNumberedStatuses(db, { statusByIndex = [], listStatus = "missing" } = {}) {
  const assignments = listAssignments(db, { status: listStatus, limit: 200 });
  const results = [];
  let successCount = 0;
  for (const item of statusByIndex) {
    const index = Number(item?.index || 0);
    const status = String(item?.status || "").trim();
    if (!index || !status) {
      results.push({ input: item, result: { ok: false, error: "Missing index or status." } });
      continue;
    }
    const assignment = assignments[index - 1];
    if (!assignment) {
      results.push({ input: item, result: { ok: false, error: `No assignment at index ${index}.` } });
      continue;
    }
    const result = updateAssignmentStatus(db, { key: assignment.key, status });
    if (result.ok) successCount += 1;
    results.push({ input: item, assignment: { key: assignment.key, title: assignment.title, course: assignment.course }, result });
  }
  return { ok: true, successCount, total: results.length, results };
}

export function addAssignmentNote(db, { key, title, course, note }) {
  let targetKey = key || null;
  if (!targetKey && title) {
    const matches = findAssignments(db, { title, course });
    if (matches.length === 1) {
      targetKey = matches[0].key;
    } else if (matches.length === 0) {
      return { ok: false, error: "No matching assignments found.", matches: [] };
    } else {
      return { ok: false, error: "Multiple assignments match that title.", matches };
    }
  }

  if (!targetKey) {
    return { ok: false, error: "Assignment key or title is required." };
  }

  const result = db
    .prepare(
      `
      INSERT INTO assignment_notes (assignment_key, note, created_at)
      VALUES (@key, @note, @created_at)
    `
    )
    .run({ key: targetKey, note, created_at: nowIso() });

  const assignment = db
    .prepare("SELECT course, title, due_date AS dueDate FROM assignments WHERE key = ?")
    .get(targetKey);

  return { ok: true, key: targetKey, noteId: result.lastInsertRowid, assignment };
}

export function scheduleReminder(db, { key, title, course, remindAt, message }) {
  let targetKey = key || null;
  if (!targetKey && title) {
    const matches = findAssignments(db, { title, course });
    if (matches.length === 1) {
      targetKey = matches[0].key;
    } else if (matches.length === 0) {
      return { ok: false, error: "No matching assignments found.", matches: [] };
    } else {
      return { ok: false, error: "Multiple assignments match that title.", matches };
    }
  }

  if (!targetKey) {
    return { ok: false, error: "Assignment key or title is required." };
  }

  const result = db
    .prepare(
      `
      INSERT INTO reminders (assignment_key, remind_at, message, created_at)
      VALUES (@key, @remind_at, @message, @created_at)
    `
    )
    .run({ key: targetKey, remind_at: remindAt, message: message || "", created_at: nowIso() });

  const assignment = db
    .prepare("SELECT course, title, due_date AS dueDate FROM assignments WHERE key = ?")
    .get(targetKey);

  return { ok: true, key: targetKey, reminderId: result.lastInsertRowid, assignment };
}

export function createTask(db, { title, remindAt, message }) {
  const taskTitle = String(title || "").trim();
  if (!taskTitle) {
    return { ok: false, error: "Task title is required." };
  }
  const remindTime = String(remindAt || "").trim();
  if (!remindTime) {
    return { ok: false, error: "Reminder time is required." };
  }

  const result = db
    .prepare(
      `
      INSERT INTO tasks (title, message, remind_at, status, created_at)
      VALUES (@title, @message, @remind_at, 'pending', @created_at)
    `
    )
    .run({
      title: taskTitle,
      message: message ? String(message) : null,
      remind_at: remindTime,
      created_at: nowIso(),
    });

  return { ok: true, id: result.lastInsertRowid, title: taskTitle, remindAt: remindTime };
}

export function listTasks(db, options = {}) {
  const status = (options.status || "pending").toLowerCase();
  const includeCompleted = status === "all";
  const start = options.start ? String(options.start) : null;
  const end = options.end ? String(options.end) : null;

  const filters = [];
  const params = {};
  if (!includeCompleted) {
    filters.push("status = @status");
    params.status = status === "done" ? "done" : "pending";
  }
  if (start) {
    filters.push("remind_at >= @start");
    params.start = start;
  }
  if (end) {
    filters.push("remind_at <= @end");
    params.end = end;
  }

  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  return db
    .prepare(
      `
      SELECT id, title, message, remind_at AS remindAt, status, created_at AS createdAt,
             completed_at AS completedAt, last_sent_at AS lastSentAt, rolled_over_at AS rolledOverAt,
             roll_count AS rollCount
      FROM tasks
      ${where}
      ORDER BY remind_at, id
    `
    )
    .all(params);
}

export function updateTaskStatus(db, { id, status }) {
  const taskId = Number(id);
  if (!Number.isFinite(taskId)) {
    return { ok: false, error: "Task id is required." };
  }
  const normalized = String(status || "").toLowerCase();
  if (!normalized) {
    return { ok: false, error: "Status is required." };
  }
  const finalStatus = normalized === "done" || normalized === "completed" ? "done" : "pending";
  const completedAt = finalStatus === "done" ? nowIso() : null;

  const result = db
    .prepare(
      `
      UPDATE tasks
      SET status = @status,
          completed_at = @completed_at
      WHERE id = @id
    `
    )
    .run({ status: finalStatus, completed_at: completedAt, id: taskId });

  if (result.changes === 0) {
    return { ok: false, error: "Task not found." };
  }

  const task = db
    .prepare("SELECT id, title, remind_at AS remindAt, status FROM tasks WHERE id = ?")
    .get(taskId);

  return { ok: true, task };
}

export function updateTask(db, { id, title, remindAt, message }) {
  const taskId = Number(id);
  if (!Number.isFinite(taskId)) {
    return { ok: false, error: "Task id is required." };
  }
  const fields = [];
  const params = { id: taskId };
  if (title !== undefined) {
    const taskTitle = String(title || "").trim();
    if (!taskTitle) return { ok: false, error: "Task title is required." };
    fields.push("title = @title");
    params.title = taskTitle;
  }
  if (remindAt !== undefined) {
    const remindTime = String(remindAt || "").trim();
    if (!remindTime) return { ok: false, error: "Reminder time is required." };
    fields.push("remind_at = @remind_at");
    params.remind_at = remindTime;
  }
  if (message !== undefined) {
    fields.push("message = @message");
    params.message = message ? String(message) : null;
  }

  if (fields.length === 0) {
    return { ok: false, error: "No updates provided." };
  }

  const result = db
    .prepare(
      `
      UPDATE tasks
      SET ${fields.join(", ")}
      WHERE id = @id
    `
    )
    .run(params);

  if (result.changes === 0) {
    return { ok: false, error: "Task not found." };
  }

  const task = db
    .prepare("SELECT id, title, remind_at AS remindAt, status, message FROM tasks WHERE id = ?")
    .get(taskId);

  return { ok: true, task };
}

export function deleteTask(db, { id }) {
  const taskId = Number(id);
  if (!Number.isFinite(taskId)) {
    return { ok: false, error: "Task id is required." };
  }
  const result = db.prepare("DELETE FROM tasks WHERE id = ?").run(taskId);
  if (result.changes === 0) {
    return { ok: false, error: "Task not found." };
  }
  return { ok: true, id: taskId };
}

export function listDueTasks(db, nowIsoValue) {
  return db
    .prepare(
      `
      SELECT id, title, message, remind_at AS remindAt, status, last_sent_at AS lastSentAt
      FROM tasks
      WHERE status = 'pending'
        AND remind_at <= @now
        AND (last_sent_at IS NULL OR last_sent_at < remind_at)
      ORDER BY remind_at, id
    `
    )
    .all({ now: nowIsoValue });
}

export function markTaskReminderSent(db, { id, sentAt, nextRemindAt }) {
  const taskId = Number(id);
  if (!Number.isFinite(taskId)) return { ok: false, error: "Task id is required." };
  const update = db
    .prepare(
      `
      UPDATE tasks
      SET last_sent_at = @sent_at,
          remind_at = @remind_at,
          rolled_over_at = @rolled_over_at,
          roll_count = roll_count + 1
      WHERE id = @id
    `
    )
    .run({
      sent_at: sentAt,
      remind_at: nextRemindAt,
      rolled_over_at: sentAt,
      id: taskId,
    });

  if (update.changes === 0) {
    return { ok: false, error: "Task not found." };
  }
  return { ok: true, id: taskId };
}

export function getChatState(db, chatId) {
  const row = db
    .prepare("SELECT chat_id AS chatId, last_response_id AS lastResponseId, turn_count AS turnCount FROM chat_state WHERE chat_id = ?")
    .get(chatId);
  if (!row) {
    return { chatId, lastResponseId: null, turnCount: 0 };
  }
  return row;
}

export function updateChatState(db, chatId, lastResponseId) {
  db.prepare(
    `
    INSERT INTO chat_state (chat_id, last_response_id, turn_count, updated_at)
    VALUES (@chat_id, @last_response_id, 1, @updated_at)
    ON CONFLICT(chat_id) DO UPDATE SET
      last_response_id = excluded.last_response_id,
      turn_count = chat_state.turn_count + 1,
      updated_at = excluded.updated_at
  `
  ).run({ chat_id: chatId, last_response_id: lastResponseId, updated_at: nowIso() });
}

export function updateChatCompaction(db, chatId, lastResponseId) {
  db.prepare(
    `
    INSERT INTO chat_state (chat_id, last_response_id, turn_count, last_compact_at, updated_at)
    VALUES (@chat_id, @last_response_id, 0, @last_compact_at, @updated_at)
    ON CONFLICT(chat_id) DO UPDATE SET
      last_response_id = excluded.last_response_id,
      turn_count = 0,
      last_compact_at = excluded.last_compact_at,
      updated_at = excluded.updated_at
  `
  ).run({
    chat_id: chatId,
    last_response_id: lastResponseId,
    last_compact_at: nowIso(),
    updated_at: nowIso(),
  });
}

export function resetChatState(db, chatId) {
  db.prepare(
    `
    INSERT INTO chat_state (chat_id, last_response_id, turn_count, updated_at)
    VALUES (@chat_id, NULL, 0, @updated_at)
    ON CONFLICT(chat_id) DO UPDATE SET
      last_response_id = NULL,
      turn_count = 0,
      updated_at = excluded.updated_at
  `
  ).run({ chat_id: chatId, updated_at: nowIso() });
}
