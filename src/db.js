import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
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
  `);
}

export function getDb(config) {
  if (dbInstance) return dbInstance;
  const dbPath = config?.paths?.agentDbPath || path.join(process.cwd(), "data", "agent.db");
  ensureDir(path.dirname(dbPath));
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  initDb(db);
  dbInstance = db;
  return dbInstance;
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

  return rows.map((row) => ({
    ...row,
    isMissing: row.isMissing === 1,
    effectiveStatus: row.manualStatus || row.status || "",
  }));
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

  const updated = db
    .prepare(
      `
      UPDATE assignments
      SET manual_status = @status,
          manual_status_updated_at = @updated_at
      WHERE key = @key
    `
    )
    .run({ status, updated_at: nowIso(), key: targetKey });

  if (updated.changes === 0) {
    return { ok: false, error: "Assignment not found." };
  }

  return { ok: true, key: targetKey, status };
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

  return { ok: true, key: targetKey, noteId: result.lastInsertRowid };
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

  return { ok: true, key: targetKey, reminderId: result.lastInsertRowid };
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
