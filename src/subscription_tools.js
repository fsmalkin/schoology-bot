// Subscription reasoning selects tools; the original app owns data and effects.
import { createDb, listAssignments } from "./db.js";
import { updateStateWithScrape } from "./storage.js";
import { syncAssignmentsFromState } from "./db.js";
import { runToolByName } from "./tool_runner.js";
import { formatFriendlyStatus, simplifyCourseName } from "./readable_messages.js";
import { readOriginalProfileSource, SourceSessionRequired } from "./schoology_profile_source.js";

const READ_TOOLS = new Set(["list_assignments", "build_daily_summary"]);
const LOCAL_TOOLS = new Set(["add_assignment_note", "update_assignment_status", "clear_assignment_notes", "clear_assignment_status"]);
const assignmentUrl = /^https:\/\/bcps\.schoology\.com\/assignment\/[1-9][0-9]*$/;
const clean = value => String(value || "").replace(/\s+/g, " ").trim();

export function openSubscriptionToolStore(config) {
  if (!config || !/^\d+$/.test(config.studentProfileId) || !/^MP ?[1-4] 20\d\d-20\d\d$/.test(config.currentTerm)) throw Error("Exact subject and term required");
  const db = createDb(config.databasePath);
  db.exec("CREATE TABLE IF NOT EXISTS subscription_source (id INTEGER PRIMARY KEY CHECK(id=1), profile TEXT NOT NULL, term TEXT NOT NULL, principal TEXT NOT NULL, term_id TEXT NOT NULL, observed_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS subscription_current_keys (key TEXT PRIMARY KEY); CREATE TABLE IF NOT EXISTS subscription_effects (id TEXT PRIMARY KEY, tool TEXT NOT NULL, before_json TEXT NOT NULL, result_json TEXT NOT NULL)");
  const binding = db.prepare("SELECT * FROM subscription_source WHERE id=1").get();
  if (binding && (binding.profile !== config.studentProfileId || binding.term !== config.currentTerm || binding.principal !== config.principalId || binding.term_id !== config.currentTermId)) { db.close(); throw Error("Stored subject or term mismatch"); }
  return db;
}

export function importQualifiedSource(db, config, source, now = new Date()) {
  const snapshot = source?.snapshot;
  if (source?.format !== "schoology-qualified-current-term/v1" || source.subjectVerified !== true || source.currentTermVerified !== true || source.sourceScope?.principalId !== config.principalId || source.sourceScope?.studentId !== config.studentProfileId || source.currentTerm?.label !== config.currentTerm || source.currentTerm?.id !== config.currentTermId || source.sourceScope?.currentTermId !== config.currentTermId || snapshot?.complete !== true || snapshot.sourceOrigin !== "https://bcps.schoology.com") throw Error("Qualified current source required");
  const age = now.getTime() - Date.parse(snapshot.observedAt);
  if (!Number.isFinite(age) || age < -30000 || age > 900000 || !Array.isArray(snapshot.assignments) || snapshot.assignments.length > 1000) throw Error("Fresh complete source required");
  for (const row of snapshot.assignments) {
    if (!clean(row.course) || !clean(row.title) || typeof row.isMissing !== "boolean" || (row.url && !assignmentUrl.test(row.url)) || Object.keys(row).some(key => !["course", "title", "dueDate", "status", "isMissing", "url"].includes(key))) throw Error("Invalid source fields");
  }
  const existing = db.prepare("SELECT key, course, title, due_date AS dueDate, status, url, first_seen_at AS firstSeenAt, last_seen_at AS lastSeenAt, last_missing_at AS lastMissingAt, resolved_at AS resolvedAt, is_missing AS isMissing FROM assignments").all();
  const state = { assignments: Object.fromEntries(existing.map(row => [row.key, { ...row, isMissing: Boolean(row.isMissing) }])), lastScrapeAt: null };
  updateStateWithScrape(state, snapshot.observedAt, snapshot.assignments);
  db.transaction(() => {
    syncAssignmentsFromState(db, state);
    db.prepare("INSERT INTO subscription_source VALUES(1,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET observed_at=excluded.observed_at").run(config.studentProfileId, config.currentTerm, config.principalId, config.currentTermId, snapshot.observedAt);
    db.exec("DELETE FROM subscription_current_keys");
    db.prepare("INSERT INTO subscription_current_keys SELECT key FROM assignments WHERE last_seen_at=?").run(snapshot.observedAt);
  })();
  return { ok: true, assignments: snapshot.assignments.length, observedAt: snapshot.observedAt };
}

export function subscriptionToolCatalog(db) {
  const source = db.prepare("SELECT * FROM subscription_source WHERE id=1").get();
  if (!source) throw Error("Current source has not been imported");
  const current = new Set(db.prepare("SELECT key FROM subscription_current_keys").all().map(row => row.key));
  return { source, assignments: listAssignments(db, { status: "all", includeIgnored: true, includePending: true, limit: 1000 }).filter(row=>current.has(row.key)).map(({ key, course, title, url, status, manualStatus, dueDate }) => ({ key, course, title, url, status, manualStatus, dueDate })) };
}

function exactTarget(db, target) {
  const rows = subscriptionToolCatalog(db).assignments;
  const matches = rows.filter(row => assignmentUrl.test(target) ? row.url === target : clean(row.title).toLowerCase() === clean(target).toLowerCase() || clean(`${row.course} / ${row.title}`).toLowerCase() === clean(target).toLowerCase());
  if (matches.length !== 1) throw Error("Use one exact assignment title or Schoology assignment link");
  return matches[0];
}

export async function executeSubscriptionTool(db, request, config = {}) {
  const source = subscriptionToolCatalog(db).source;
  const name = request?.toolName;
  if (!READ_TOOLS.has(name) && !LOCAL_TOOLS.has(name) && name !== "refresh_schoology") throw Error("Tool is outside the enabled scope; reminders remain off");
  if (!/^telegram-update-\d+$/.test(request.operationId || "")) throw Error("Stable Telegram update identity required");
  if (db.prepare("SELECT id FROM subscription_effects WHERE id=?").get(request.operationId)) throw Error("Completed tool effect; do not replay");
  if (name === "refresh_schoology") {
    let fresh;
    try { fresh = await readOriginalProfileSource(config); }
    catch (error) {
      if (!(error instanceof SourceSessionRequired)) throw error;
      return { ok: false, code: "SOURCE_SESSION_REQUIRED", reply: "The code-driven scraper needs sign-in in its separate Schoology app Chrome window. Saved data has not been refreshed; your usual Chrome login was not copied." };
    }
    return db.transaction(() => {
      const result = importQualifiedSource(db, config, fresh);
      const reply = `Refreshed ${result.assignments} current-term assignments through the code-driven scraper at ${result.observedAt}. Local notes and statuses were preserved. Reminders remain off.`;
      const value = { ...result, toolName: name, reply };
      db.prepare("INSERT INTO subscription_effects VALUES(?,?,?,?)").run(request.operationId, name, "{}", JSON.stringify(value));
      return value;
    })();
  }
  let args = request.arguments || {};
  let targetKey = null;
  if (READ_TOOLS.has(name)) {
    const allowed = name === "list_assignments" ? ["status", "course", "limit", "includeIgnored", "includePending", "bucketed", "target"] : [];
    if (Object.keys(args).some(key => !allowed.includes(key))) throw Error("Unexpected tool arguments");
    if (name === "list_assignments" && args.target) {
      targetKey = exactTarget(db, args.target).key;
      args = { status: "all", includeIgnored: true, includePending: true, limit: 1000, bucketed: false };
    } else {
      args = name === "list_assignments" ? { ...args, limit: Math.min(Number(args.limit) || 30, 100), bucketed: false } : { state: { lastScrapeAt: source.observed_at, assignments: {} } };
      delete args.target;
    }
  } else {
    const age = Date.now() - Date.parse(source.observed_at);
    if (!Number.isFinite(age) || age < -30000 || age > 900000) return { ok: false, reply: "Refresh the saved Schoology data before changing a local note or status. No change was saved." };
    if (!request.localRequest || !["note", "status", "clear-notes", "clear-status"].includes(request.localRequest.operation)) throw Error("Explicit local edit required");
    const operationTool = { note: "add_assignment_note", status: "update_assignment_status", "clear-notes": "clear_assignment_notes", "clear-status": "clear_assignment_status" };
    if (operationTool[request.localRequest.operation] !== name) throw Error("Local operation mismatch");
    const row = exactTarget(db, request.localRequest.target);
    const value = request.localRequest.value;
    if ((name === "add_assignment_note" || name === "update_assignment_status") && (typeof value !== "string" || !value.trim() || value.length > (name === "add_assignment_note" ? 2000 : 160))) throw Error("Invalid local value");
    args = { key: row.key, ...(name === "add_assignment_note" ? { note: value } : { status: value }) };
  }
  db.exec("BEGIN IMMEDIATE");
  try {
    const before = LOCAL_TOOLS.has(name) ? { assignment: db.prepare("SELECT * FROM assignments WHERE key=?").get(args.key), notes: db.prepare("SELECT * FROM assignment_notes WHERE assignment_key=?").all(args.key) } : {};
    let output;
    if (name === "clear_assignment_notes") { db.prepare("DELETE FROM assignment_notes WHERE assignment_key=?").run(args.key); output = { ok: true }; }
    else if (name === "clear_assignment_status") output = await runToolByName(db, "update_assignment_status", { key: args.key, status: "" });
    else output = await runToolByName(db, name, args);
    if (!output?.ok) throw Error(output?.error || "Original tool refused request");
    if (targetKey) output = { ...output, assignments: output.assignments.filter(row => row.key === targetKey) };
    const reply = toolReply(db, name, args, output, source);
    const result = { ok: true, toolName: name, observedAt: source.observed_at, reply };
    db.prepare("INSERT INTO subscription_effects VALUES(?,?,?,?)").run(request.operationId, name, JSON.stringify(before), JSON.stringify(result));
    db.exec("COMMIT");
    return result;
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

function toolReply(db, name, args, output, source) {
  if (name === "build_daily_summary") return `Saved Schoology data observed ${source.observed_at}\n\n${output.summaryText || "No actionable assignments."}`.slice(0,3500);
  if (name === "list_assignments") {
    const rows = Array.isArray(output.assignments) ? output.assignments : [];
    const lines = rows.map(row => {
      const notes = db.prepare("SELECT note FROM assignment_notes WHERE assignment_key=? ORDER BY id").all(row.key);
      const sourceStatus = row.status === "Not marked missing" ? "Not marked missing (submission status unknown)" : formatFriendlyStatus(row.status || "Unknown");
      return `${row.title} — ${simplifyCourseName(row.course)}\nSchoology: ${sourceStatus}${row.manualStatus ? `\nLocal status: ${row.manualStatus}` : ""}${row.dueDate ? `\nDue: ${row.dueDate}` : ""}${notes.map(n => `\nNote: ${n.note}`).join("")}${row.url ? `\n${row.url}` : ""}`;
    });
    return `Saved Schoology data observed ${source.observed_at}\n\n${lines.length ? lines.join("\n\n") : "No matching assignments."}`.slice(0, 3500);
  }
  const title = db.prepare("SELECT title FROM assignments WHERE key=?").get(args.key)?.title || "assignment";
  if (name === "add_assignment_note") return `Saved a local note for ${title}: ${args.note}\nSchoology was not changed.`;
  if (name === "update_assignment_status") return `Set the local status for ${title} to ${output.status}.\nSchoology was not changed.`;
  return `Cleared the local ${name === "clear_assignment_notes" ? "notes" : "status"} for ${title}. Local change history is retained; Schoology was not changed.`;
}

export async function runSubscriptionToolCommand(config, input) {
  const db = openSubscriptionToolStore(config);
  try {
    if (input.command === "import") return importQualifiedSource(db, config, input.source);
    if (input.command === "catalog") return subscriptionToolCatalog(db);
    if (input.command === "execute") return await executeSubscriptionTool(db, input, config);
    throw Error("Unsupported tool command");
  } finally { db.close(); }
}
