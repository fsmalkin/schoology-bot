import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { getManualStatusCategory, normalizeManualStatus } from "./statuses.js";
import { nowIso, parseSchoologyDate } from "./time.js";
import { extractAssignmentId, loadState } from "./storage.js";
import { deriveSchoologyAssignmentTitle } from "./text_utils.js";

let dbInstance = null;

const RECURRENCE_KIND_VALUES = ["none", "daily", "weekdays", "weekly"];
const RECURRENCE_KIND_SET = new Set(RECURRENCE_KIND_VALUES);
const CHAT_MESSAGE_STYLE_VALUES = ["compact", "plain_language"];
const CHAT_MESSAGE_STYLE_SET = new Set(CHAT_MESSAGE_STYLE_VALUES);
const DEFAULT_CHAT_MESSAGE_STYLE = "compact";
const RECURRENCE_ALIAS_MAP = new Map([
  ["one-time", "none"],
  ["one time", "none"],
  ["once", "none"],
  ["every day", "daily"],
  ["everyday", "daily"],
  ["weekday", "weekdays"],
  ["every weekday", "weekdays"],
  ["workdays", "weekdays"],
  ["every week", "weekly"],
]);

export function normalizeRecurrenceKind(value, { allowNull = false } = {}) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return { ok: true, value: allowNull ? null : "none" };
  }
  const raw = String(value).trim().toLowerCase();
  const mapped = RECURRENCE_ALIAS_MAP.get(raw) || raw;
  if (!RECURRENCE_KIND_SET.has(mapped)) {
    return {
      ok: false,
      error: `Recurrence is invalid. Use one of: ${RECURRENCE_KIND_VALUES.join(", ")}.`,
    };
  }
  return { ok: true, value: mapped };
}

export function normalizeChatMessageStyle(value, { allowNull = false } = {}) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return { ok: true, value: allowNull ? null : DEFAULT_CHAT_MESSAGE_STYLE };
  }
  const raw = String(value).trim().toLowerCase();
  if (!CHAT_MESSAGE_STYLE_SET.has(raw)) {
    return {
      ok: false,
      error: `Message style is invalid. Use one of: ${CHAT_MESSAGE_STYLE_VALUES.join(", ")}.`,
    };
  }
  return { ok: true, value: raw };
}

function normalizeRecurrenceTz(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed ? trimmed : null;
}

function normalizeRemindAt(remindAt) {
  const value = String(remindAt || "").trim();
  if (!value) {
    return { ok: false, error: "Reminder time is required." };
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    return {
      ok: false,
      error:
        "Reminder time is invalid. Please use a specific date/time like 2026-02-05T16:00:00-05:00.",
    };
  }
  return { ok: true, value };
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function sleepSync(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return;
  try {
    // Atomics.wait provides a simple synchronous sleep without busy looping.
    const sab = new SharedArrayBuffer(4);
    const int32 = new Int32Array(sab);
    Atomics.wait(int32, 0, 0, ms);
  } catch {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      // busy wait fallback (should be rare)
    }
  }
}

function maybeMigrateLegacyDb(dbPath, legacyDbPath) {
  if (!dbPath || dbPath === ":memory:") return;
  if (!legacyDbPath) return;

  let resolvedDbPath = dbPath;
  let resolvedLegacy = legacyDbPath;
  try {
    resolvedDbPath = path.resolve(dbPath);
    resolvedLegacy = path.resolve(legacyDbPath);
  } catch {
    // leave as-is
  }

  if (resolvedDbPath === resolvedLegacy) return;
  if (fs.existsSync(resolvedDbPath)) return;
  if (!fs.existsSync(resolvedLegacy)) return;

  ensureDir(path.dirname(resolvedDbPath));

  const lockPath = `${resolvedDbPath}.migrate.lock`;
  let lockFd = null;
  try {
    lockFd = fs.openSync(lockPath, "wx");
  } catch (err) {
    // Another process/container is migrating. Wait briefly for the target DB to appear.
    if (err && err.code === "EEXIST") {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        if (fs.existsSync(resolvedDbPath)) return;
        sleepSync(100);
      }
    }
    return;
  }

  try {
    if (!fs.existsSync(resolvedDbPath)) {
      const tmp = `${resolvedDbPath}.tmp`;
      fs.copyFileSync(resolvedLegacy, tmp);
      fs.renameSync(tmp, resolvedDbPath);
    }

    // If legacy had WAL/shm files, bring them too.
    for (const suffix of ["-wal", "-shm"]) {
      const legacySidecar = `${resolvedLegacy}${suffix}`;
      const targetSidecar = `${resolvedDbPath}${suffix}`;
      if (!fs.existsSync(legacySidecar) || fs.existsSync(targetSidecar)) continue;
      const tmp = `${targetSidecar}.tmp`;
      fs.copyFileSync(legacySidecar, tmp);
      fs.renameSync(tmp, targetSidecar);
    }
  } finally {
    try {
      if (lockFd) fs.closeSync(lockFd);
    } catch {
      // ignore
    }
    try {
      fs.unlinkSync(lockPath);
    } catch {
      // ignore
    }
  }
}

function ensureSchemaMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);
}

function getSchemaVersion(db) {
  const row = db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get();
  return row?.version ? Number(row.version) : 0;
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
      assignment_id TEXT,
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

    CREATE TABLE IF NOT EXISTS chat_state (
      chat_id TEXT PRIMARY KEY,
      last_response_id TEXT,
      turn_count INTEGER NOT NULL DEFAULT 0,
      last_compact_at TEXT,
      message_style TEXT NOT NULL DEFAULT 'compact',
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS chat_memory (
      chat_id TEXT PRIMARY KEY,
      summary_text TEXT NOT NULL,
      source_response_id TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS pending_actions (
      chat_id TEXT PRIMARY KEY,
      tool TEXT NOT NULL,
      args_json TEXT,
      note TEXT,
      matches_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_assignments_course ON assignments(course);
    CREATE INDEX IF NOT EXISTS idx_assignments_due_date ON assignments(due_date);
    CREATE INDEX IF NOT EXISTS idx_assignments_missing ON assignments(is_missing);
    CREATE INDEX IF NOT EXISTS idx_notes_assignment ON assignment_notes(assignment_key);
    CREATE INDEX IF NOT EXISTS idx_reminders_pending ON reminders(sent_at, remind_at);
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_remind_at ON tasks(remind_at);
  `);

  runMigrations(db);
}

function ensureTaskColumns(db) {
  const columns = db.prepare("PRAGMA table_info(tasks)").all().map((row) => row.name);
  const addColumn = (name, type, defaultValue) => {
    if (columns.includes(name)) return;
    const clause = defaultValue !== undefined ? ` DEFAULT ${defaultValue}` : "";
    db.exec(`ALTER TABLE tasks ADD COLUMN ${name} ${type}${clause}`);
  };

  addColumn("assignment_key", "TEXT");
  addColumn("kind", "TEXT", "'personal'");
  addColumn("auto_cancel_on_resolve", "INTEGER", "0");
  addColumn("auto_planned", "INTEGER", "0");
  addColumn("recurrence_kind", "TEXT", "'none'");
  addColumn("recurrence_tz", "TEXT");
}

function ensureAssignmentAutoIgnoreColumns(db) {
  const tableExists = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='assignments'")
    .get();
  if (!tableExists) return;
  const columns = db.prepare("PRAGMA table_info(assignments)").all().map((row) => row.name);
  const addColumn = (name, type, defaultValue) => {
    if (columns.includes(name)) return;
    const clause = defaultValue !== undefined ? ` DEFAULT ${defaultValue}` : "";
    db.exec(`ALTER TABLE assignments ADD COLUMN ${name} ${type}${clause}`);
  };

  addColumn("auto_ignored", "INTEGER", "0");
  addColumn("auto_ignore_reason", "TEXT");
  addColumn("auto_ignored_at", "TEXT");
}

function ensureTaskIndexes(db) {
  try {
    db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_assignment ON tasks(assignment_key);");
    db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_kind_status ON tasks(kind, status);");
  } catch (err) {
    // Column may not exist on older DBs until migration completes; ignore.
  }
}

function ensureChatStateColumns(db) {
  const tableExists = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='chat_state'")
    .get();
  if (!tableExists) return;
  const columns = db.prepare("PRAGMA table_info(chat_state)").all().map((row) => row.name);
  const addColumn = (name, type, defaultValue) => {
    if (columns.includes(name)) return;
    const clause = defaultValue !== undefined ? ` DEFAULT ${defaultValue}` : "";
    db.exec(`ALTER TABLE chat_state ADD COLUMN ${name} ${type}${clause}`);
  };

  addColumn("last_compact_at", "TEXT");
  addColumn("message_style", "TEXT", `'${DEFAULT_CHAT_MESSAGE_STYLE}'`);
  addColumn("updated_at", "TEXT");
}

function ensureChatMemoryTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_memory (
      chat_id TEXT PRIMARY KEY,
      summary_text TEXT NOT NULL,
      source_response_id TEXT,
      updated_at TEXT NOT NULL
    );
  `);
}

function parseIsoMs(value) {
  const t = Date.parse(String(value || ""));
  return Number.isFinite(t) ? t : null;
}

function pickLatestDateString(...values) {
  let best = null;
  let bestMs = null;
  for (const value of values) {
    if (!value) continue;
    const ms = parseIsoMs(value);
    if (ms === null) continue;
    if (bestMs === null || ms > bestMs) {
      best = value;
      bestMs = ms;
    }
  }
  return best;
}

function pickEarliestDateString(...values) {
  let best = null;
  let bestMs = null;
  for (const value of values) {
    if (!value) continue;
    const ms = parseIsoMs(value);
    if (ms === null) continue;
    if (bestMs === null || ms < bestMs) {
      best = value;
      bestMs = ms;
    }
  }
  return best;
}

function normalizeAssignmentKeyForId(assignmentId, fallbackKey = "") {
  const id = String(assignmentId || "").trim();
  if (!id) return String(fallbackKey || "").trim();
  return `assignment:${id}`;
}

function withDerivedAssignmentTitle(row) {
  if (!row) return row;
  return {
    ...row,
    title: deriveSchoologyAssignmentTitle({
      title: row.title || "",
      rawText: row.rawText || "",
    }),
  };
}

function buildAssignmentTaskTitle(row) {
  const assignment = withDerivedAssignmentTitle(row);
  const course = String(assignment?.course || "").trim();
  const title = String(assignment?.title || "").trim();
  if (course && title) return `${course} - ${title}`;
  return title || course || "Assignment reminder";
}

function ensureAssignmentIdentityColumns(db) {
  const tableExists = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='assignments'")
    .get();
  if (!tableExists) return;
  const columns = db.prepare("PRAGMA table_info(assignments)").all().map((row) => row.name);
  if (!columns.includes("assignment_id")) {
    db.exec("ALTER TABLE assignments ADD COLUMN assignment_id TEXT");
  }
}

function ensureAssignmentIdentityIndex(db) {
  const tableExists = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='assignments'")
    .get();
  if (!tableExists) return;
  db.exec("CREATE INDEX IF NOT EXISTS idx_assignments_assignment_id ON assignments(assignment_id)");
}

function relinkAssignmentReferences(db, fromKey, toKey) {
  if (!fromKey || !toKey || fromKey === toKey) return;
  db.prepare("UPDATE assignment_notes SET assignment_key = @to WHERE assignment_key = @from").run({
    from: fromKey,
    to: toKey,
  });
  db.prepare("UPDATE tasks SET assignment_key = @to WHERE assignment_key = @from").run({
    from: fromKey,
    to: toKey,
  });
  const remindersTable = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='reminders'")
    .get();
  if (remindersTable) {
    db.prepare("UPDATE reminders SET assignment_key = @to WHERE assignment_key = @from").run({
      from: fromKey,
      to: toKey,
    });
  }
}

function choosePreferredAssignmentRow(a, b) {
  if (!a) return b;
  if (!b) return a;
  const canonicalA = normalizeAssignmentKeyForId(a.assignmentId, "") === a.key;
  const canonicalB = normalizeAssignmentKeyForId(b.assignmentId, "") === b.key;
  if (canonicalA !== canonicalB) return canonicalA ? a : b;
  const aSeen = parseIsoMs(a.lastSeenAt || a.firstSeenAt || "");
  const bSeen = parseIsoMs(b.lastSeenAt || b.firstSeenAt || "");
  if (aSeen !== null && bSeen !== null && aSeen !== bSeen) return aSeen > bSeen ? a : b;
  if (aSeen !== null && bSeen === null) return a;
  if (bSeen !== null && aSeen === null) return b;
  return a;
}

function mergeAssignmentRows(preferred, duplicate) {
  const newest = choosePreferredAssignmentRow(preferred, duplicate);
  const older = newest === preferred ? duplicate : preferred;
  const keepAutoIgnored = (newest.autoIgnored || 0) === 1 || (older.autoIgnored || 0) === 1;
  return {
    key: preferred.key,
    assignment_id: preferred.assignmentId || duplicate.assignmentId || "",
    course: newest.course || older.course || "",
    title: newest.title || older.title || "",
    due_date: newest.dueDate || older.dueDate || "",
    status: newest.status || older.status || "",
    score: newest.score || older.score || "",
    url: newest.url || older.url || "",
    raw_text: newest.rawText || older.rawText || "",
    first_seen_at: pickEarliestDateString(preferred.firstSeenAt, duplicate.firstSeenAt) || newest.firstSeenAt || "",
    last_seen_at: pickLatestDateString(preferred.lastSeenAt, duplicate.lastSeenAt) || newest.lastSeenAt || "",
    last_missing_at: pickLatestDateString(preferred.lastMissingAt, duplicate.lastMissingAt),
    resolved_at: pickLatestDateString(preferred.resolvedAt, duplicate.resolvedAt),
    is_missing:
      (choosePreferredAssignmentRow(
        { key: preferred.key, assignmentId: preferred.assignmentId, lastSeenAt: preferred.lastSeenAt, firstSeenAt: preferred.firstSeenAt },
        { key: duplicate.key, assignmentId: duplicate.assignmentId, lastSeenAt: duplicate.lastSeenAt, firstSeenAt: duplicate.firstSeenAt }
      ) === preferred
        ? preferred.isMissing
        : duplicate.isMissing) || 0,
    manual_status: preferred.manualStatus || duplicate.manualStatus || null,
    manual_status_updated_at:
      pickLatestDateString(preferred.manualStatusUpdatedAt, duplicate.manualStatusUpdatedAt) || null,
    auto_ignored: keepAutoIgnored ? 1 : 0,
    auto_ignore_reason:
      newest.autoIgnoreReason ||
      older.autoIgnoreReason ||
      (keepAutoIgnored ? "merged-duplicate" : null),
    auto_ignored_at: pickLatestDateString(preferred.autoIgnoredAt, duplicate.autoIgnoredAt) || null,
  };
}

function dedupeAssignmentGroup(db, assignmentId) {
  const id = String(assignmentId || "").trim();
  if (!id) return;
  const rows = db
    .prepare(
      `
      SELECT
        key,
        assignment_id AS assignmentId,
        course,
        title,
        due_date AS dueDate,
        status,
        score,
        url,
        raw_text AS rawText,
        first_seen_at AS firstSeenAt,
        last_seen_at AS lastSeenAt,
        last_missing_at AS lastMissingAt,
        resolved_at AS resolvedAt,
        is_missing AS isMissing,
        manual_status AS manualStatus,
        manual_status_updated_at AS manualStatusUpdatedAt,
        auto_ignored AS autoIgnored,
        auto_ignore_reason AS autoIgnoreReason,
        auto_ignored_at AS autoIgnoredAt
      FROM assignments
      WHERE assignment_id = @id
      ORDER BY key
    `
    )
    .all({ id });
  if (rows.length <= 1) return;

  const canonicalKey = normalizeAssignmentKeyForId(id, rows[0].key);
  let winner =
    rows.find((row) => row.key === canonicalKey) ||
    rows.reduce((best, row) => choosePreferredAssignmentRow(best, row), null);
  const winnerKey = winner?.key || rows[0].key;

  const updateAssignment = db.prepare(
    `
    UPDATE assignments
    SET assignment_id = @assignment_id,
        course = @course,
        title = @title,
        due_date = @due_date,
        status = @status,
        score = @score,
        url = @url,
        raw_text = @raw_text,
        first_seen_at = @first_seen_at,
        last_seen_at = @last_seen_at,
        last_missing_at = @last_missing_at,
        resolved_at = @resolved_at,
        is_missing = @is_missing,
        manual_status = @manual_status,
        manual_status_updated_at = @manual_status_updated_at,
        auto_ignored = @auto_ignored,
        auto_ignore_reason = @auto_ignore_reason,
        auto_ignored_at = @auto_ignored_at
    WHERE key = @key
  `
  );

  for (const row of rows) {
    if (row.key === winnerKey) continue;
    const merged = mergeAssignmentRows(winner, row);
    relinkAssignmentReferences(db, row.key, winnerKey);
    updateAssignment.run({ ...merged, key: winnerKey });
    db.prepare("DELETE FROM assignments WHERE key = ?").run(row.key);
    winner = db
      .prepare(
        `
        SELECT
          key,
          assignment_id AS assignmentId,
          course,
          title,
          due_date AS dueDate,
          status,
          score,
          url,
          raw_text AS rawText,
          first_seen_at AS firstSeenAt,
          last_seen_at AS lastSeenAt,
          last_missing_at AS lastMissingAt,
          resolved_at AS resolvedAt,
          is_missing AS isMissing,
          manual_status AS manualStatus,
          manual_status_updated_at AS manualStatusUpdatedAt,
          auto_ignored AS autoIgnored,
          auto_ignore_reason AS autoIgnoreReason,
          auto_ignored_at AS autoIgnoredAt
        FROM assignments
        WHERE key = ?
      `
      )
      .get(winnerKey);
  }

  if (winnerKey !== canonicalKey) {
    const canonicalExists = db.prepare("SELECT key FROM assignments WHERE key = ?").get(canonicalKey);
    if (canonicalExists) {
      relinkAssignmentReferences(db, winnerKey, canonicalKey);
      db.prepare("DELETE FROM assignments WHERE key = ?").run(winnerKey);
    } else {
      db.prepare("UPDATE assignments SET key = ? WHERE key = ?").run(canonicalKey, winnerKey);
      relinkAssignmentReferences(db, winnerKey, canonicalKey);
    }
  }
}

function migrateAssignmentIdentity(db) {
  const tableExists = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='assignments'")
    .get();
  if (!tableExists) return;
  ensureAssignmentIdentityColumns(db);
  ensureAssignmentIdentityIndex(db);

  const rows = db
    .prepare("SELECT key, url, assignment_id AS assignmentId FROM assignments")
    .all();
  const setAssignmentId = db.prepare(
    "UPDATE assignments SET assignment_id = @assignment_id WHERE key = @key"
  );
  const ids = new Set();
  for (const row of rows) {
    const currentId = String(row.assignmentId || "").trim();
    const derivedId = currentId || extractAssignmentId(row.url || "");
    if (!derivedId) continue;
    if (currentId !== derivedId) {
      setAssignmentId.run({ key: row.key, assignment_id: derivedId });
    }
    ids.add(derivedId);
  }

  for (const assignmentId of ids) {
    dedupeAssignmentGroup(db, assignmentId);
  }
}

function migrateRemindersToTasks(db) {
  const remindersTable = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='reminders'")
    .get();
  if (!remindersTable) return;

  const assignmentsTable = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='assignments'")
    .get();

  const pending = db
    .prepare(
      `
      SELECT id, assignment_key AS assignmentKey, remind_at AS remindAt, message, created_at AS createdAt
      FROM reminders
      WHERE sent_at IS NULL
    `
    )
    .all();
  if (!pending.length) return;

  const lookupAssignment = assignmentsTable
    ? db.prepare("SELECT course, title, raw_text AS rawText FROM assignments WHERE key = ?")
    : null;
  const insertTask = db.prepare(
    `
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
    )
    VALUES (
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
  `
  );

  for (const reminder of pending) {
    const existing = db
      .prepare(
        `
        SELECT id FROM tasks
        WHERE assignment_key = @assignment_key AND remind_at = @remind_at AND kind = 'assignment' AND status = 'pending'
      `
      )
      .get({ assignment_key: reminder.assignmentKey, remind_at: reminder.remindAt });
    if (existing) {
      db.prepare("DELETE FROM reminders WHERE id = ?").run(reminder.id);
      continue;
    }
    const assignment = lookupAssignment ? withDerivedAssignmentTitle(lookupAssignment.get(reminder.assignmentKey)) : null;
    const title = buildAssignmentTaskTitle(assignment);
    insertTask.run({
      assignment_key: reminder.assignmentKey,
      title,
      message: reminder.message || "",
      remind_at: reminder.remindAt,
      created_at: reminder.createdAt || nowIso(),
    });
    db.prepare("DELETE FROM reminders WHERE id = ?").run(reminder.id);
  }
}

function runMigrations(db) {
  ensureSchemaMigrations(db);
  const migrations = [
    {
      version: 1,
      name: "tasks-columns-and-index",
      apply: () => {
        ensureTaskColumns(db);
        ensureTaskIndexes(db);
      },
    },
    {
      version: 2,
      name: "pending-actions",
      apply: () => {
        db.exec(`
          CREATE TABLE IF NOT EXISTS pending_actions (
            chat_id TEXT PRIMARY KEY,
            tool TEXT NOT NULL,
            args_json TEXT,
            note TEXT,
            matches_json TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );
        `);
      },
    },
    {
      version: 3,
      name: "assignment-auto-ignore",
      apply: () => {
        ensureAssignmentAutoIgnoreColumns(db);
      },
    },
    {
      version: 4,
      name: "task-auto-planned",
      apply: () => {
        ensureTaskColumns(db);
        db.exec(`
          UPDATE tasks
          SET auto_planned = 1
          WHERE auto_planned = 0
            AND kind = 'assignment'
            AND message LIKE 'Auto reminder for upcoming due date%'
        `);
      },
    },
    {
      version: 5,
      name: "task-recurrence-and-reminder-unification",
      apply: () => {
        ensureTaskColumns(db);
        ensureTaskIndexes(db);
        migrateRemindersToTasks(db);
      },
    },
    {
      version: 6,
      name: "assignment-identity-canonicalization",
      apply: () => {
        migrateAssignmentIdentity(db);
      },
    },
    {
      version: 7,
      name: "chat-memory-and-style",
      apply: () => {
        ensureChatStateColumns(db);
        ensureChatMemoryTable(db);
      },
    },
  ];

  const currentVersion = getSchemaVersion(db);
  for (const migration of migrations) {
    if (migration.version <= currentVersion) continue;
    const applyTx = db.transaction(() => {
      migration.apply();
      db.prepare(
        "INSERT INTO schema_migrations (version, applied_at) VALUES (@version, @applied_at)"
      ).run({ version: migration.version, applied_at: nowIso() });
    });
    applyTx();
  }
}

export function migrateDb(db) {
  runMigrations(db);
}

export function createDb(dbPath = ":memory:") {
  const db = new Database(dbPath);
  try {
    db.pragma("journal_mode = WAL");
  } catch (err) {
    console.warn(
      "WAL unavailable, falling back to DELETE mode:",
      err?.message || err
    );
    db.pragma("journal_mode = DELETE");
  }
  initDb(db);
  return db;
}

export function getDb(config) {
  if (dbInstance) return dbInstance;
  const dbPath = config?.paths?.agentDbPath || path.join(process.cwd(), "data", "agent.db");
  ensureDir(path.dirname(dbPath));
  const legacyDbPath = config?.paths?.dataDir
    ? path.join(config.paths.dataDir, "agent.db")
    : path.join(process.cwd(), "data", "agent.db");
  maybeMigrateLegacyDb(dbPath, legacyDbPath);
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

export function getPendingAction(db, chatId) {
  if (!chatId) return null;
  const row = db
    .prepare(
      `SELECT chat_id AS chatId, tool, args_json AS argsJson, note, matches_json AS matchesJson
       FROM pending_actions WHERE chat_id = ?`
    )
    .get(chatId);
  if (!row) return null;
  let args = null;
  let matches = null;
  try {
    args = row.argsJson ? JSON.parse(row.argsJson) : null;
  } catch (err) {
    args = null;
  }
  try {
    matches = row.matchesJson ? JSON.parse(row.matchesJson) : null;
  } catch (err) {
    matches = null;
  }
  return {
    chatId: row.chatId,
    tool: row.tool,
    args,
    note: row.note || null,
    matches,
  };
}

export function setPendingAction(db, { chatId, tool, args, note, matches }) {
  if (!chatId || !tool) return { ok: false, error: "Missing chatId or tool." };
  const payload = {
    chat_id: chatId,
    tool,
    args_json: args ? JSON.stringify(args) : null,
    note: note || null,
    matches_json: matches ? JSON.stringify(matches) : null,
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  db.prepare(
    `
    INSERT INTO pending_actions (chat_id, tool, args_json, note, matches_json, created_at, updated_at)
    VALUES (@chat_id, @tool, @args_json, @note, @matches_json, @created_at, @updated_at)
    ON CONFLICT(chat_id) DO UPDATE SET
      tool = excluded.tool,
      args_json = excluded.args_json,
      note = excluded.note,
      matches_json = excluded.matches_json,
      updated_at = excluded.updated_at
  `
  ).run(payload);
  return { ok: true };
}

export function clearPendingAction(db, chatId) {
  if (!chatId) return { ok: false, error: "Missing chatId." };
  const result = db.prepare("DELETE FROM pending_actions WHERE chat_id = ?").run(chatId);
  return { ok: true, cleared: result.changes || 0 };
}

export function syncAssignmentsFromState(db, state) {
  if (!state?.assignments) return;
  migrateAssignmentIdentity(db);
  const upsert = db.prepare(`
    INSERT INTO assignments (
      key, course, title, due_date, status, score, url, assignment_id, raw_text,
      first_seen_at, last_seen_at, last_missing_at, resolved_at, is_missing
    ) VALUES (
      @key, @course, @title, @due_date, @status, @score, @url, @assignment_id, @raw_text,
      @first_seen_at, @last_seen_at, @last_missing_at, @resolved_at, @is_missing
    )
    ON CONFLICT(key) DO UPDATE SET
      course = excluded.course,
      title = excluded.title,
      due_date = excluded.due_date,
      status = excluded.status,
      score = excluded.score,
      url = excluded.url,
      assignment_id = excluded.assignment_id,
      raw_text = excluded.raw_text,
      last_seen_at = excluded.last_seen_at,
      last_missing_at = excluded.last_missing_at,
      resolved_at = excluded.resolved_at,
      is_missing = excluded.is_missing;
  `);

  const tx = db.transaction((items) => {
    const ids = new Set();
    for (const item of items) {
      upsert.run(item);
      const assignmentId = String(item.assignment_id || "").trim();
      if (assignmentId) ids.add(assignmentId);
    }
    for (const assignmentId of ids) {
      dedupeAssignmentGroup(db, assignmentId);
    }
  });

  const rows = Object.values(state.assignments).map((item) => {
    const assignmentId = extractAssignmentId(item.url || "") || String(item.assignmentId || "").trim();
    const key =
      normalizeAssignmentKeyForId(assignmentId, item.key || "") ||
      String(item.key || "").trim();
    const rawText = item.rawText || "";
    return {
      key,
      assignment_id: assignmentId || null,
      course: item.course || "",
      title: deriveSchoologyAssignmentTitle({ title: item.title || "", rawText }),
      due_date: item.dueDate || "",
      status: item.status || "",
      score: item.score || "",
      url: item.url || "",
      raw_text: rawText,
      first_seen_at: item.firstSeenAt || "",
      last_seen_at: item.lastSeenAt || "",
      last_missing_at: item.lastMissingAt || "",
      resolved_at: item.resolvedAt || "",
      is_missing: item.isMissing ? 1 : 0,
    };
  });

  tx(rows);
}

export function ensureDbSeeded(db, statePath) {
  const count = db.prepare("SELECT COUNT(*) AS count FROM assignments").get();
  if (count && count.count > 0) return;
  const state = loadState(statePath);
  syncAssignmentsFromState(db, state);
}

function isSubmittedUngraded(row) {
  const text = `${row.status || ""} ${row.rawText || ""}`.toLowerCase();
  return (
    text.includes("submitted, awaiting grade") ||
    text.includes("submission that has not been graded") ||
    text.includes("assignment submitted")
  );
}

export function listAssignments(db, options = {}) {
  const status = (options.status || "missing").toLowerCase();
  const course = options.course ? String(options.course).toLowerCase() : null;
  const limit = Number.isFinite(options.limit) ? Math.max(1, Math.min(options.limit, 1000)) : 50;
  const includeIgnored = options.includeIgnored === true;
  const includePending = options.includePending !== false;
  const bucketed = options.bucketed === true;

  const filters = [];
  const params = { limit };

  if (status === "missing") filters.push("is_missing = 1");
  if (status === "resolved") filters.push("is_missing = 0");
  if (status === "all") {
    // no-op
  }
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
        assignment_id AS assignmentId,
        course,
        title,
        due_date AS dueDate,
        status,
        raw_text AS rawText,
        manual_status AS manualStatus,
        auto_ignored AS autoIgnored,
        auto_ignore_reason AS autoIgnoreReason,
        auto_ignored_at AS autoIgnoredAt,
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

  const mapped = rows.map((sourceRow) => {
    const row = withDerivedAssignmentTitle(sourceRow);
    const manualStatus = row.manualStatus || "";
    const manualCategory = getManualStatusCategory(manualStatus);
    const autoIgnored = row.autoIgnored === 1;
    const inferredSubmittedUngraded = row.isMissing === 1 && isSubmittedUngraded(row);
    const statusCategory = autoIgnored
      ? "ignored"
      : inferredSubmittedUngraded
      ? "ignored"
      : manualCategory;
    return {
      ...row,
      isMissing: row.isMissing === 1,
      autoIgnored,
      effectiveStatus:
        manualStatus || (inferredSubmittedUngraded ? "Submitted, awaiting grade" : row.status || ""),
      statusCategory,
    };
  });

  const filtered = mapped.filter((row) => {
    if (!includeIgnored && row.statusCategory === "ignored") return false;
    if (!includePending && row.statusCategory === "pending") return false;
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

export function applyAutoIgnoreRules(db, { now, oldDays = 120, keywords = [] } = {}) {
  const nowDate = now ? new Date(now) : new Date();
  const cutoffMs = nowDate.getTime() - oldDays * 24 * 60 * 60 * 1000;
  const keywordList = (keywords || [])
    .map((value) => String(value || "").trim().toLowerCase())
    .filter((value) => value.length > 0);

  const rows = db
    .prepare(
      `
      SELECT key, title, status, raw_text AS rawText, due_date AS dueDate,
             manual_status AS manualStatus, auto_ignored AS autoIgnored, is_missing AS isMissing
      FROM assignments
    `
    )
    .all();

  let updated = 0;
  const setIgnore = db.prepare(
    `
    UPDATE assignments
    SET auto_ignored = 1,
        auto_ignore_reason = @reason,
        auto_ignored_at = @now
    WHERE key = @key
  `
  );
  const clearIgnore = db.prepare(
    `
    UPDATE assignments
    SET auto_ignored = 0,
        auto_ignore_reason = NULL,
        auto_ignored_at = NULL
    WHERE key = @key
  `
  );

  for (const row of rows) {
    if (row.manualStatus) {
      if (row.autoIgnored) {
        clearIgnore.run({ key: row.key });
        updated += 1;
      }
      continue;
    }

    if (row.isMissing !== 1) {
      if (row.autoIgnored) {
        clearIgnore.run({ key: row.key });
        updated += 1;
      }
      continue;
    }

    let reason = "";
    const dueDate = parseSchoologyDate(row.dueDate);
    if (dueDate && dueDate.getTime() < cutoffMs) {
      reason = "Past grading period (auto)";
    }

    if (!reason && keywordList.length > 0) {
      const haystack = `${row.title || ""} ${row.status || ""} ${row.rawText || ""}`.toLowerCase();
      const matched = keywordList.find((keyword) => keyword && haystack.includes(keyword));
      if (matched) {
        reason = `Auto-ignored keyword: ${matched}`;
      }
    }

    if (reason && !row.autoIgnored) {
      setIgnore.run({ key: row.key, reason, now: nowIso() });
      updated += 1;
      continue;
    }
    if (!reason && row.autoIgnored) {
      clearIgnore.run({ key: row.key });
      updated += 1;
    }
  }

  return { ok: true, updated };
}

export function findPendingAssignmentTask(db, { key }) {
  if (!key) return null;
  return db
    .prepare(
      `
      SELECT id, remind_at AS remindAt, status, message,
             recurrence_kind AS recurrenceKind, recurrence_tz AS recurrenceTz
      FROM tasks
      WHERE assignment_key = @key AND status = 'pending' AND kind = 'assignment'
      ORDER BY remind_at ASC
      LIMIT 1
    `
    )
    .get({ key });
}

export function createAssignmentTask(
  db,
  { key, title, remindAt, message, autoPlanned = false, recurrence, recurrenceTz }
) {
  if (!key) return { ok: false, error: "Assignment key is required." };
  const remindCheck = normalizeRemindAt(remindAt);
  if (!remindCheck.ok) return { ok: false, error: remindCheck.error };
  const remindTime = remindCheck.value;
  const recurrenceCheck = normalizeRecurrenceKind(recurrence);
  if (!recurrenceCheck.ok) return { ok: false, error: recurrenceCheck.error };
  const recurrenceKind = recurrenceCheck.value;
  const recurrenceZone = normalizeRecurrenceTz(recurrenceTz);
  const taskTitle = String(title || "Assignment reminder").trim() || "Assignment reminder";
  const result = db
    .prepare(
      `
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
      )
      VALUES (
        @assignment_key,
        @title,
        @message,
        @remind_at,
        'pending',
        'assignment',
        1,
        @auto_planned,
        @recurrence_kind,
        @recurrence_tz,
        @created_at
      )
    `
    )
    .run({
      assignment_key: key,
      title: taskTitle,
      message: message ? String(message) : null,
      remind_at: remindTime,
      auto_planned: autoPlanned ? 1 : 0,
      recurrence_kind: recurrenceKind,
      recurrence_tz: recurrenceZone,
      created_at: nowIso(),
    });

  return {
    ok: true,
    id: result.lastInsertRowid,
    remindAt: remindTime,
    recurrenceKind,
    recurrenceTz: recurrenceZone,
  };
}

export function findAssignments(db, options = {}) {
  const title = options.title ? String(options.title).toLowerCase() : null;
  const course = options.course ? String(options.course).toLowerCase() : null;
  if (!title) return [];
  const params = { title: `%${title}%` };
  const filters = ["(LOWER(title) LIKE @title OR LOWER(raw_text) LIKE @title)"];
  if (course) {
    filters.push("LOWER(course) LIKE @course");
    params.course = `%${course}%`;
  }
  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  return db
    .prepare(
      `
      SELECT key, course, title, due_date AS dueDate, status, manual_status AS manualStatus
             , raw_text AS rawText
             , assignment_id AS assignmentId
      FROM assignments
      ${where}
      ORDER BY LOWER(course), due_date, LOWER(title)
      LIMIT 20
    `
    )
    .all(params)
    .map((row) => withDerivedAssignmentTitle(row));
}

function loadAssignmentByKey(db, key) {
  return withDerivedAssignmentTitle(
    db
      .prepare(
        `
        SELECT
          key,
          course,
          title,
          due_date AS dueDate,
          status,
          manual_status AS manualStatus,
          raw_text AS rawText,
          assignment_id AS assignmentId,
          auto_ignored AS autoIgnored,
          auto_ignore_reason AS autoIgnoreReason,
          is_missing AS isMissing
        FROM assignments
        WHERE key = ?
      `
      )
      .get(key)
  );
}

function resolveAssignmentSelection(db, { key, title, course } = {}) {
  let targetKey = key ? String(key).trim() : "";
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

  const assignment = loadAssignmentByKey(db, targetKey);
  if (!assignment) {
    return { ok: false, error: "Assignment not found." };
  }

  return { ok: true, key: targetKey, assignment };
}

export function getAssignmentFollowUpContext(db, { key, title, course } = {}) {
  const resolved = resolveAssignmentSelection(db, { key, title, course });
  if (!resolved.ok) return resolved;

  const assignment = resolved.assignment;
  const notes = listAssignmentNotes(db, { keys: [assignment.key], limitPerAssignment: 3 }).get(assignment.key) || [];
  const reminders = listReminders(db, { key: assignment.key, status: "pending" });
  const manualStatus = String(assignment.manualStatus || "").trim();
  const inferredSubmittedUngraded = Number(assignment.isMissing || 0) === 1 && isSubmittedUngraded(assignment);
  const statusCategory =
    Number(assignment.autoIgnored || 0) === 1
      ? "ignored"
      : inferredSubmittedUngraded
      ? "ignored"
      : getManualStatusCategory(manualStatus);
  const effectiveStatus =
    manualStatus || (inferredSubmittedUngraded ? "Submitted, awaiting grade" : assignment.status || "");

  return {
    ok: true,
    assignment: {
      ...assignment,
      isMissing: Number(assignment.isMissing || 0) === 1,
      autoIgnored: Number(assignment.autoIgnored || 0) === 1,
      effectiveStatus,
      statusCategory,
    },
    notes,
    latestNote: notes[0] || null,
    pendingReminder: reminders[0] || null,
    pendingReminderCount: reminders.length,
  };
}

export function updateAssignmentStatus(db, { key, title, course, status }) {
  const resolved = resolveAssignmentSelection(db, { key, title, course });
  if (!resolved.ok) return resolved;
  const targetKey = resolved.key;

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

  const assignment = loadAssignmentByKey(db, targetKey);

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
  const existing = db
    .prepare("SELECT key FROM assignments WHERE key = ?")
    .get(targetKey);
  if (!existing) {
    return { ok: false, error: "Assignment not found." };
  }

  const result = db
    .prepare(
      `
      INSERT INTO assignment_notes (assignment_key, note, created_at)
      VALUES (@key, @note, @created_at)
    `
    )
    .run({ key: targetKey, note, created_at: nowIso() });

  const assignment = loadAssignmentByKey(db, targetKey);

  return { ok: true, key: targetKey, noteId: result.lastInsertRowid, assignment };
}

export function listAssignmentNotes(db, { keys = [], limitPerAssignment = 3 } = {}) {
  if (!Array.isArray(keys) || keys.length === 0) return new Map();
  const placeholders = keys.map(() => "?").join(",");
  const rows = db
    .prepare(
      `
      SELECT assignment_key AS assignmentKey, note, created_at AS createdAt
      FROM assignment_notes
      WHERE assignment_key IN (${placeholders})
      ORDER BY created_at DESC
    `
    )
    .all(keys);

  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(row.assignmentKey)) grouped.set(row.assignmentKey, []);
    const list = grouped.get(row.assignmentKey);
    if (list.length >= limitPerAssignment) continue;
    list.push({ note: row.note, createdAt: row.createdAt });
  }

  return grouped;
}

function selectAssignmentReminderTask(db, id) {
  return db
    .prepare(
      `
      SELECT
        id,
        assignment_key AS assignmentKey,
        title,
        message,
        remind_at AS remindAt,
        status,
        created_at AS createdAt,
        last_sent_at AS sentAt,
        recurrence_kind AS recurrenceKind,
        recurrence_tz AS recurrenceTz
      FROM tasks
      WHERE id = ? AND kind = 'assignment'
    `
    )
    .get(id);
}

export function scheduleReminder(
  db,
  { key, title, course, remindAt, message, replaceExisting = true, recurrence, recurrenceTz }
) {
  const remindCheck = normalizeRemindAt(remindAt);
  if (!remindCheck.ok) return { ok: false, error: remindCheck.error };
  const remindTime = remindCheck.value;
  const recurrenceCheck = normalizeRecurrenceKind(recurrence);
  if (!recurrenceCheck.ok) return { ok: false, error: recurrenceCheck.error };
  const recurrenceKind = recurrenceCheck.value;
  const recurrenceZone = normalizeRecurrenceTz(recurrenceTz);
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
  const existing = db
    .prepare("SELECT key FROM assignments WHERE key = ?")
    .get(targetKey);
  if (!existing) {
    return { ok: false, error: "Assignment not found." };
  }
  const assignment = loadAssignmentByKey(db, targetKey);
  const taskTitle = buildAssignmentTaskTitle(assignment);

  if (replaceExisting) {
    const existing = db
      .prepare(
        `
        SELECT id
        FROM tasks
        WHERE assignment_key = @key
          AND kind = 'assignment'
          AND status = 'pending'
        ORDER BY id DESC
      `
      )
      .all({ key: targetKey });

    if (existing.length > 0) {
      const [keep, ...rest] = existing;
      db.prepare(
        `
        UPDATE tasks
        SET remind_at = @remind_at,
            message = @message,
            title = @title,
            recurrence_kind = @recurrence_kind,
            recurrence_tz = @recurrence_tz,
            last_sent_at = NULL,
            completed_at = NULL,
            status = 'pending'
        WHERE id = @id
      `
      ).run({
        remind_at: remindTime,
        message: message || "",
        title: taskTitle,
        recurrence_kind: recurrenceKind,
        recurrence_tz: recurrenceZone,
        id: keep.id,
      });
      if (rest.length > 0) {
        const ids = rest.map((row) => row.id);
        db.prepare(`DELETE FROM tasks WHERE id IN (${ids.map(() => "?").join(",")})`).run(ids);
      }
      const reminder = selectAssignmentReminderTask(db, keep.id);

      return {
        ok: true,
        key: targetKey,
        reminderId: keep.id,
        replaced: true,
        deletedDuplicates: rest.length,
        assignment,
        reminder,
      };
    }
  }

  const result = db
    .prepare(
      `
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
      )
      VALUES (
        @assignment_key,
        @title,
        @message,
        @remind_at,
        'pending',
        'assignment',
        1,
        0,
        @recurrence_kind,
        @recurrence_tz,
        @created_at
      )
    `
    )
    .run({
      assignment_key: targetKey,
      title: taskTitle,
      remind_at: remindTime,
      message: message || "",
      recurrence_kind: recurrenceKind,
      recurrence_tz: recurrenceZone,
      created_at: nowIso(),
    });

  const reminder = selectAssignmentReminderTask(db, result.lastInsertRowid);
  return {
    ok: true,
    key: targetKey,
    reminderId: result.lastInsertRowid,
    assignment,
    reminder,
  };
}

export function listReminders(db, { key, status = "pending" } = {}) {
  const filters = ["kind = 'assignment'"];
  const params = {};
  if (key) {
    filters.push("assignment_key = @key");
    params.key = key;
  }
  if (status !== "all") {
    if (status === "sent") {
      filters.push("(status = 'done' OR last_sent_at IS NOT NULL)");
    } else {
      filters.push("status = 'pending'");
    }
  }
  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  return db
    .prepare(
      `
      SELECT
        id,
        assignment_key AS assignmentKey,
        title,
        remind_at AS remindAt,
        message,
        created_at AS createdAt,
        status,
        last_sent_at AS sentAt,
        recurrence_kind AS recurrenceKind,
        recurrence_tz AS recurrenceTz
      FROM tasks
      ${where}
      ORDER BY remind_at, id
    `
    )
    .all(params);
}

export function updateReminder(db, { id, remindAt, message, recurrence, recurrenceTz }) {
  const reminderId = Number(id);
  if (!Number.isFinite(reminderId)) {
    return { ok: false, error: "Reminder id is required." };
  }
  const fields = [];
  const params = { id: reminderId };
  if (remindAt !== undefined && remindAt !== null) {
    const remindCheck = normalizeRemindAt(remindAt);
    if (!remindCheck.ok) return { ok: false, error: remindCheck.error };
    fields.push("remind_at = @remind_at");
    params.remind_at = remindCheck.value;
    fields.push("last_sent_at = NULL");
  }
  if (message !== undefined && message !== null) {
    fields.push("message = @message");
    params.message = message ? String(message) : "";
  }
  if (recurrence !== undefined && recurrence !== null) {
    const recurrenceCheck = normalizeRecurrenceKind(recurrence);
    if (!recurrenceCheck.ok) return { ok: false, error: recurrenceCheck.error };
    fields.push("recurrence_kind = @recurrence_kind");
    params.recurrence_kind = recurrenceCheck.value;
  }
  if (recurrenceTz !== undefined) {
    fields.push("recurrence_tz = @recurrence_tz");
    params.recurrence_tz = normalizeRecurrenceTz(recurrenceTz);
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
        AND kind = 'assignment'
    `
    )
    .run(params);
  if (result.changes === 0) {
    return { ok: false, error: "Reminder not found." };
  }
  const reminder = selectAssignmentReminderTask(db, reminderId);
  return { ok: true, reminder };
}

export function deleteReminder(db, { id }) {
  const reminderId = Number(id);
  if (!Number.isFinite(reminderId)) {
    return { ok: false, error: "Reminder id is required." };
  }
  const result = db
    .prepare("DELETE FROM tasks WHERE id = @id AND kind = 'assignment'")
    .run({ id: reminderId });
  if (result.changes === 0) {
    return { ok: false, error: "Reminder not found." };
  }
  return { ok: true, id: reminderId };
}

export function dedupePendingReminders(db, { key } = {}) {
  const params = {};
  if (key) params.key = key;
  const keyFilter = key ? "AND assignment_key = @key" : "";
  const groups = db
    .prepare(
      `
      SELECT assignment_key AS assignmentKey, COUNT(*) AS count
      FROM tasks
      WHERE kind = 'assignment'
        AND status = 'pending'
        ${keyFilter}
      GROUP BY assignment_key
      HAVING COUNT(*) > 1
    `
    )
    .all(params);

  let removed = 0;
  for (const group of groups) {
    const rows = db
      .prepare(
        `
        SELECT id
        FROM tasks
        WHERE assignment_key = @key
          AND kind = 'assignment'
          AND status = 'pending'
        ORDER BY created_at DESC, id DESC
      `
      )
      .all({ key: group.assignmentKey });
    const [, ...rest] = rows;
    if (rest.length > 0) {
      const ids = rest.map((row) => row.id);
      const res = db.prepare(`DELETE FROM tasks WHERE id IN (${ids.map(() => "?").join(",")})`).run(ids);
      removed += res.changes || 0;
    }
  }
  return { ok: true, removed };
}

export function listResolvedWithManualStatus(db, sinceIso) {
  return db
    .prepare(
      `
      SELECT a.key, a.course, a.title, a.raw_text AS rawText, a.manual_status AS manualStatus,
             (SELECT COUNT(*) FROM assignment_notes n WHERE n.assignment_key = a.key) AS notesCount
      FROM assignments a
      WHERE a.is_missing = 0
        AND a.resolved_at >= @since
        AND a.manual_status IS NOT NULL
      ORDER BY a.resolved_at DESC
    `
    )
    .all({ since: sinceIso })
    .map((row) => withDerivedAssignmentTitle(row));
}

export function clearManualStatuses(db, keys = []) {
  if (!Array.isArray(keys) || keys.length === 0) return { ok: true, cleared: 0 };
  const placeholders = keys.map(() => "?").join(",");
  const result = db
    .prepare(
      `
      UPDATE assignments
      SET manual_status = NULL,
          manual_status_updated_at = NULL
      WHERE key IN (${placeholders})
    `
    )
    .run(keys);
  return { ok: true, cleared: result.changes || 0 };
}

export function createTask(db, { title, remindAt, message, recurrence, recurrenceTz }) {
  const taskTitle = String(title || "").trim();
  if (!taskTitle) {
    return { ok: false, error: "Task title is required." };
  }
  const remindCheck = normalizeRemindAt(remindAt);
  if (!remindCheck.ok) return { ok: false, error: remindCheck.error };
  const remindTime = remindCheck.value;
  const recurrenceCheck = normalizeRecurrenceKind(recurrence);
  if (!recurrenceCheck.ok) return { ok: false, error: recurrenceCheck.error };
  const recurrenceKind = recurrenceCheck.value;
  const recurrenceZone = normalizeRecurrenceTz(recurrenceTz);

  const result = db
    .prepare(
      `
      INSERT INTO tasks (
        title,
        message,
        remind_at,
        status,
        recurrence_kind,
        recurrence_tz,
        created_at
      )
      VALUES (
        @title,
        @message,
        @remind_at,
        'pending',
        @recurrence_kind,
        @recurrence_tz,
        @created_at
      )
    `
    )
    .run({
      title: taskTitle,
      message: message ? String(message) : null,
      remind_at: remindTime,
      recurrence_kind: recurrenceKind,
      recurrence_tz: recurrenceZone,
      created_at: nowIso(),
    });

  return {
    ok: true,
    id: result.lastInsertRowid,
    title: taskTitle,
    remindAt: remindTime,
    recurrenceKind,
    recurrenceTz: recurrenceZone,
  };
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
      SELECT
        id,
        assignment_key AS assignmentKey,
        title,
        message,
        remind_at AS remindAt,
        status,
        kind,
        auto_cancel_on_resolve AS autoCancelOnResolve,
        auto_planned AS autoPlanned,
        recurrence_kind AS recurrenceKind,
        recurrence_tz AS recurrenceTz,
        created_at AS createdAt,
        completed_at AS completedAt,
        last_sent_at AS lastSentAt,
        rolled_over_at AS rolledOverAt,
        roll_count AS rollCount
      FROM tasks
      ${where}
      ORDER BY remind_at, id
    `
    )
    .all(params);
}

export function completeResolvedAssignmentReminders(db, { completedAt = nowIso() } = {}) {
  const rows = db
    .prepare(
      `
      SELECT
        t.id,
        a.key,
        a.status,
        a.raw_text AS rawText,
        a.manual_status AS manualStatus,
        a.auto_ignored AS autoIgnored,
        a.is_missing AS isMissing
      FROM tasks t
      JOIN assignments a ON a.key = t.assignment_key
      WHERE t.kind = 'assignment'
        AND t.status = 'pending'
        AND t.auto_cancel_on_resolve = 1
    `
    )
    .all();

  const completeTask = db.prepare(
    `
      UPDATE tasks
      SET status = 'done',
          completed_at = @completed_at
      WHERE id = @id
        AND status = 'pending'
    `
  );

  let completed = 0;
  const completedIds = [];
  for (const row of rows) {
    const pendingManualOnly =
      Number(row.isMissing || 0) === 1 &&
      Number(row.autoIgnored || 0) !== 1 &&
      !isSubmittedUngraded(row) &&
      getManualStatusCategory(row.manualStatus || "") === "pending";
    if (pendingManualOnly) continue;

    const shouldComplete =
      Number(row.isMissing || 0) !== 1 ||
      Number(row.autoIgnored || 0) === 1 ||
      isSubmittedUngraded(row);
    if (!shouldComplete) continue;

    const result = completeTask.run({ id: row.id, completed_at: completedAt });
    if (result.changes > 0) {
      completed += 1;
      completedIds.push(row.id);
    }
  }

  return { ok: true, completed, ids: completedIds };
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
  const query =
    finalStatus === "pending"
      ? `
      UPDATE tasks
      SET status = @status,
          completed_at = @completed_at,
          last_sent_at = NULL
      WHERE id = @id
    `
      : `
      UPDATE tasks
      SET status = @status,
          completed_at = @completed_at
      WHERE id = @id
    `;

  const result = db.prepare(query).run({ status: finalStatus, completed_at: completedAt, id: taskId });

  if (result.changes === 0) {
    return { ok: false, error: "Task not found." };
  }

  const task = db
    .prepare(
      `SELECT
         id,
         title,
         remind_at AS remindAt,
         status,
         recurrence_kind AS recurrenceKind,
         recurrence_tz AS recurrenceTz
       FROM tasks
       WHERE id = ?`
    )
    .get(taskId);

  return { ok: true, task };
}

export function updateTask(db, { id, title, remindAt, message, recurrence, recurrenceTz }) {
  const taskId = Number(id);
  if (!Number.isFinite(taskId)) {
    return { ok: false, error: "Task id is required." };
  }
  const fields = [];
  const params = { id: taskId };
  if (title !== undefined && title !== null) {
    const taskTitle = String(title || "").trim();
    if (!taskTitle) return { ok: false, error: "Task title is required." };
    fields.push("title = @title");
    params.title = taskTitle;
  }
  if (remindAt !== undefined && remindAt !== null) {
    const remindCheck = normalizeRemindAt(remindAt);
    if (!remindCheck.ok) return { ok: false, error: remindCheck.error };
    fields.push("remind_at = @remind_at");
    params.remind_at = remindCheck.value;
    fields.push("last_sent_at = NULL");
  }
  if (message !== undefined && message !== null) {
    fields.push("message = @message");
    params.message = message ? String(message) : null;
  }
  if (recurrence !== undefined && recurrence !== null) {
    const recurrenceCheck = normalizeRecurrenceKind(recurrence);
    if (!recurrenceCheck.ok) return { ok: false, error: recurrenceCheck.error };
    fields.push("recurrence_kind = @recurrence_kind");
    params.recurrence_kind = recurrenceCheck.value;
  }
  if (recurrenceTz !== undefined) {
    fields.push("recurrence_tz = @recurrence_tz");
    params.recurrence_tz = normalizeRecurrenceTz(recurrenceTz);
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
    .prepare(
      `SELECT
         id,
         title,
         remind_at AS remindAt,
         status,
         message,
         recurrence_kind AS recurrenceKind,
         recurrence_tz AS recurrenceTz
       FROM tasks
       WHERE id = ?`
    )
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
      SELECT
        id,
        assignment_key AS assignmentKey,
        title,
        message,
        remind_at AS remindAt,
        status,
        kind,
        recurrence_kind AS recurrenceKind,
        recurrence_tz AS recurrenceTz,
        last_sent_at AS lastSentAt
      FROM tasks
      WHERE status = 'pending'
        AND datetime(remind_at) <= datetime(@now)
        AND (last_sent_at IS NULL OR datetime(last_sent_at) < datetime(remind_at))
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
    .prepare(
      `SELECT
         chat_id AS chatId,
         last_response_id AS lastResponseId,
         turn_count AS turnCount,
         last_compact_at AS lastCompactAt,
         message_style AS messageStyle,
         updated_at AS updatedAt
       FROM chat_state
       WHERE chat_id = ?`
    )
    .get(chatId);
  if (!row) {
    return {
      chatId,
      lastResponseId: null,
      turnCount: 0,
      lastCompactAt: null,
      messageStyle: DEFAULT_CHAT_MESSAGE_STYLE,
      updatedAt: null,
    };
  }
  return {
    ...row,
    messageStyle: normalizeChatMessageStyle(row.messageStyle, { allowNull: false }).value,
  };
}

export function getChatMemory(db, chatId) {
  if (!chatId) return null;
  const row = db
    .prepare(
      `SELECT
         chat_id AS chatId,
         summary_text AS summaryText,
         source_response_id AS sourceResponseId,
         updated_at AS updatedAt
       FROM chat_memory
       WHERE chat_id = ?`
    )
    .get(chatId);
  return row || null;
}

export function upsertChatMemory(db, { chatId, summaryText, sourceResponseId = null, updatedAt = nowIso() } = {}) {
  if (!chatId) return { ok: false, error: "Chat id is required." };
  const text = String(summaryText || "").trim();
  if (!text) return { ok: false, error: "Summary text is required." };

  db.prepare(
    `
    INSERT INTO chat_memory (chat_id, summary_text, source_response_id, updated_at)
    VALUES (@chat_id, @summary_text, @source_response_id, @updated_at)
    ON CONFLICT(chat_id) DO UPDATE SET
      summary_text = excluded.summary_text,
      source_response_id = excluded.source_response_id,
      updated_at = excluded.updated_at
  `
  ).run({
    chat_id: chatId,
    summary_text: text,
    source_response_id: sourceResponseId ? String(sourceResponseId) : null,
    updated_at: updatedAt,
  });

  return { ok: true, chatId, summaryText: text, sourceResponseId: sourceResponseId || null, updatedAt };
}

export function setChatMessageStyle(db, chatId, messageStyle, { updatedAt = nowIso() } = {}) {
  if (!chatId) return { ok: false, error: "Chat id is required." };
  const normalized = normalizeChatMessageStyle(messageStyle);
  if (!normalized.ok) return normalized;

  db.prepare(
    `
    INSERT INTO chat_state (chat_id, last_response_id, turn_count, last_compact_at, message_style, updated_at)
    VALUES (@chat_id, NULL, 0, NULL, @message_style, @updated_at)
    ON CONFLICT(chat_id) DO UPDATE SET
      message_style = excluded.message_style,
      updated_at = excluded.updated_at
  `
  ).run({
    chat_id: chatId,
    message_style: normalized.value,
    updated_at: updatedAt,
  });

  return { ok: true, chatId, messageStyle: normalized.value, updatedAt };
}

export function updateChatState(db, chatId, lastResponseId) {
  db.prepare(
    `
    INSERT INTO chat_state (chat_id, last_response_id, turn_count, message_style, updated_at)
    VALUES (@chat_id, @last_response_id, 1, @message_style, @updated_at)
    ON CONFLICT(chat_id) DO UPDATE SET
      last_response_id = excluded.last_response_id,
      turn_count = chat_state.turn_count + 1,
      updated_at = excluded.updated_at
  `
  ).run({
    chat_id: chatId,
    last_response_id: lastResponseId,
    message_style: DEFAULT_CHAT_MESSAGE_STYLE,
    updated_at: nowIso(),
  });
}

export function updateChatCompaction(db, chatId, lastResponseId) {
  db.prepare(
    `
    INSERT INTO chat_state (chat_id, last_response_id, turn_count, last_compact_at, message_style, updated_at)
    VALUES (@chat_id, @last_response_id, 0, @last_compact_at, @message_style, @updated_at)
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
    message_style: DEFAULT_CHAT_MESSAGE_STYLE,
    updated_at: nowIso(),
  });
}

export function resetChatState(db, chatId) {
  db.prepare(
    `
    INSERT INTO chat_state (chat_id, last_response_id, turn_count, message_style, updated_at)
    VALUES (@chat_id, NULL, 0, @message_style, @updated_at)
    ON CONFLICT(chat_id) DO UPDATE SET
      last_response_id = NULL,
      turn_count = 0,
      updated_at = excluded.updated_at
  `
  ).run({ chat_id: chatId, message_style: DEFAULT_CHAT_MESSAGE_STYLE, updated_at: nowIso() });
}
