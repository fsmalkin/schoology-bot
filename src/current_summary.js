import { buildReadableDailySummary } from "./readable_messages.js";
import { getSubmittedSchoologyStatusLabel } from "./statuses.js";
import { classifySchoologyDueDate } from "./time.js";

export const CURRENT_SNAPSHOT_FORMAT = "schoology-current-assignments/v1";
const MAX_SNAPSHOT_AGE_MS = 15 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 60 * 1000;

export class CurrentSnapshotError extends Error {}

function reject(message) {
  throw new CurrentSnapshotError(message);
}

function currentOrigin(value) {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      !/(^|\.)schoology\.com$/i.test(url.hostname) ||
      url.username || url.password || url.port || url.search || url.hash ||
      url.pathname !== "/"
    ) reject("The snapshot needs a Schoology HTTPS origin.");
    return url.origin;
  } catch {
    reject("The snapshot needs a Schoology HTTPS origin.");
  }
}

function assignmentLink(value, origin) {
  if (!value) return "";
  try {
    const url = new URL(value, origin);
    if (url.protocol !== "https:" || url.origin !== origin || url.username || url.password) return "";
    // Keep assignment links without copying account/session query parameters.
    url.search = "";
    url.hash = "";
    return url.href;
  } catch {
    return "";
  }
}

function currentRow(row, origin) {
  if (!row || typeof row !== "object" || Array.isArray(row) || typeof row.isMissing !== "boolean") {
    reject("Each current assignment needs an explicit missing status.");
  }
  if (typeof row.course !== "string" || !row.course.trim() || typeof row.title !== "string" || !row.title.trim()) {
    reject("Each current assignment needs a course and title.");
  }
  for (const name of ["status", "dueDate", "url"]) {
    if (row[name] !== undefined && typeof row[name] !== "string") reject("Current assignment fields must be text.");
  }
  // Deliberately copy only current Schoology fields. Saved manual statuses,
  // notes, auto-ignore flags, tasks and conversational memory are not inputs.
  return {
    course: row.course.trim(),
    title: row.title.trim(),
    status: (row.status || "").trim(),
    dueDate: (row.dueDate || "").trim(),
    url: assignmentLink(row.url, origin),
    isMissing: row.isMissing,
  };
}

export function buildCurrentSummary(snapshot, { now = new Date(), timeZone = "America/New_York" } = {}) {
  if (!snapshot || snapshot.format !== CURRENT_SNAPSHOT_FORMAT || !Array.isArray(snapshot.assignments)) {
    reject("Provide an explicit current Schoology snapshot, not saved application state.");
  }
  if (typeof snapshot.complete !== "boolean" || snapshot.assignments.length > 1000) {
    reject("The snapshot must declare whether its assignment coverage is complete (maximum 1000 rows).");
  }
  const nowDate = new Date(now);
  const observed = new Date(snapshot.observedAt);
  if (
    typeof snapshot.observedAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(snapshot.observedAt) ||
    !Number.isFinite(observed.getTime()) || !Number.isFinite(nowDate.getTime())
  ) reject("The snapshot needs a valid observation time with a timezone.");
  if (nowDate - observed > MAX_SNAPSHOT_AGE_MS) reject("The snapshot is older than 15 minutes. Read current Schoology records again.");
  if (observed - nowDate > MAX_FUTURE_SKEW_MS) reject("The snapshot observation time is in the future.");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(nowDate);
  } catch {
    reject("Choose a valid report timezone.");
  }
  const origin = currentOrigin(snapshot.sourceOrigin);
  const unique = new Map();
  for (const sourceRow of snapshot.assignments) {
    const row = currentRow(sourceRow, origin);
    const identity = row.url || JSON.stringify([row.course, row.title, row.dueDate]);
    const existing = unique.get(identity);
    if (existing && JSON.stringify(existing) !== JSON.stringify(row)) {
      reject("The current snapshot has conflicting copies of an assignment. Read a consistent view again.");
    }
    unique.set(identity, row);
  }
  let submittedAwaitingGrade = 0;
  const missing = [];
  for (const row of unique.values()) {
    if (getSubmittedSchoologyStatusLabel(row)) {
      submittedAwaitingGrade += 1;
    } else if (row.isMissing) {
      missing.push({ ...row, ...classifySchoologyDueDate(row.dueDate, timeZone, nowDate) });
    }
  }
  missing.sort((a, b) =>
    a.course.localeCompare(b.course) ||
    String(a.dueDateIso || a.dueDate).localeCompare(String(b.dueDateIso || b.dueDate)) ||
    a.title.localeCompare(b.title)
  );
  let text = buildReadableDailySummary({
    summary: { actionable: missing, pending: [] },
    reminders: { today: [], overdue: [], upcoming: [] },
    state: { lastScrapeAt: observed.toISOString() },
    timeZone,
    now: nowDate,
  });
  if (!missing.length) {
    text = text.replace("Nothing to do right now.", snapshot.complete
      ? "No missing assignments in this complete current Schoology snapshot."
      : "No missing assignments visible in the captured rows; coverage is incomplete.");
  }
  const coverage = snapshot.complete ? "Current Schoology records" : "Partial Schoology view - other rows may be missing";
  const summaryText = [
    coverage,
    `Missing: ${missing.length}. Submitted work: ${submittedAwaitingGrade} (excluded from missing work).`,
    "",
    text,
    "",
    "Saved exceptions, notes and reminder history are not included.",
  ].join("\n");
  return { summaryText, missing, submittedAwaitingGrade, observedAt: observed.toISOString(), complete: snapshot.complete };
}
