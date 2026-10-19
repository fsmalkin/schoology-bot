import { formatDateYmd, getLocalDateTimeParts } from "./time.js";
import { isExemptSchoologyStatus, isSubmittedSchoologyStatus, normalizeManualStatus } from "./statuses.js";

// Source submission evidence is independent of grades, actionable flags and local notes.
export function submissionEvidence(row = {}) {
  const status = String(row.status || "").trim();
  const draft = /\bdraft\b.*\bnot submitted\b/i.test(status);
  const missing = /^missing(?:\s*\(|$)/i.test(status);
  const incomplete = /^incomplete(?:\s*\(|$)/i.test(status);
  const sourceConflict = /Schoology also marks (?:Missing|Incomplete)/i.test(status);
  const completedSubmission = /this student has completed assignment submission/i.test(String(row.rawText || row.raw_text || ""));
  if (isExemptSchoologyStatus(row)) return "exempt";
  if (isSubmittedSchoologyStatus(row) || completedSubmission) return draft || missing || incomplete || sourceConflict || row.isMissing === true || row.isMissing === 1 ? "conflicting" : "submitted";
  if (missing && (row.isMissing === false || row.isMissing === 0)) return "conflicting";
  if (normalizeManualStatus(row.manualStatus) === "Submitted") return draft || missing ? "conflicting" : "unknown";
  if (draft || missing) return "unsubmitted";
  // Incomplete means incomplete work; it does not prove no submission.
  return "unknown";
}

function validDate(year, month, day) {
  if (year < 2000 || year > 2199 || month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// Overdue reads require a real deadline. Date-only dates retain unknown time.
// Ambiguous fall-back and nonexistent spring-forward wall times are not guessed.
export function deadlineEvidence(value, timeZone = "America/New_York", now = new Date()) {
  const text = String(value || "").trim();
  const unknown = { overdue: false, kind: "unknown", dueDateYmd: null, dueDateIso: null };
  const nowDate = new Date(now);
  if (!Number.isFinite(nowDate.getTime())) return unknown;
  let match = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})(?:\s+(\d{1,2}):(\d{2})\s*(am|pm)?)?$/i.exec(text);
  let year, month, day, hour, minute, hasTime;
  if (match) {
    month = Number(match[1]); day = Number(match[2]); year = Number(match[3]);
    if (match[3].length === 2) year += 2000;
    hasTime = match[4] !== undefined;
    hour = Number(match[4]); minute = Number(match[5]);
    if (hasTime && match[6]) {
      if (hour < 1 || hour > 12) return unknown;
      hour = hour % 12 + (match[6].toLowerCase() === "pm" ? 12 : 0);
    }
  } else {
    match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2}))?$/.exec(text);
    if (!match) return unknown;
    year = Number(match[1]); month = Number(match[2]); day = Number(match[3]);
    hasTime = match[4] !== undefined;
    hour = Number(match[4]); minute = Number(match[5]);
    if (hasTime) {
      const seconds = Number(match[6] || 0);
      const offset = match[8];
      if (!validDate(year, month, day) || hour > 23 || minute > 59 || seconds > 59 ||
          (offset !== "Z" && (Number(offset.slice(1, 3)) > 23 || Number(offset.slice(4)) > 59))) return unknown;
      const parsed = new Date(text);
      if (!Number.isFinite(parsed.getTime())) return unknown;
      return { overdue: parsed < nowDate, kind: "exact", dueDateYmd: formatDateYmd(parsed, timeZone), dueDateIso: parsed.toISOString() };
    }
  }
  if (!validDate(year, month, day)) return unknown;
  const ymd = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  if (!hasTime) return { overdue: ymd < formatDateYmd(nowDate, timeZone), kind: "date-only", dueDateYmd: ymd, dueDateIso: null };
  if (hour > 23 || minute > 59) return unknown;
  const wallUtc = Date.UTC(year, month - 1, day, hour, minute);
  const candidates = new Set();
  for (const delta of [-36, 0, 36]) {
    const probe = new Date(wallUtc + delta * 3600000);
    const local = getLocalDateTimeParts(probe, timeZone);
    const offset = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute) - probe.getTime();
    const candidate = wallUtc - offset;
    const actual = getLocalDateTimeParts(new Date(candidate), timeZone);
    if (actual.year === year && actual.month === month && actual.day === day && actual.hour === hour && actual.minute === minute) candidates.add(candidate);
  }
  if (candidates.size !== 1) return unknown;
  const parsed = new Date([...candidates][0]);
  return { overdue: parsed < nowDate, kind: "exact", dueDateYmd: ymd, dueDateIso: parsed.toISOString() };
}
