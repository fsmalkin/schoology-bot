import { listAssignments, listAssignmentNotes } from "./db.js";

function toSummaryItem(row, notes = []) {
  return {
    key: row.key,
    course: row.course || "",
    title: row.title || "",
    dueDate: row.dueDate || "",
    status: row.effectiveStatus || row.status || "",
    manualStatus: row.manualStatus || "",
    url: row.url || "",
    statusCategory: row.statusCategory || "",
    dueCategory: row.dueCategory || "undated",
    dueDateYmd: row.dueDateYmd || null,
    dueDateIso: row.dueDateIso || null,
    notesCount: Number(row.notesCount || 0),
    notes,
  };
}

export function buildDbSummary(
  db,
  {
    includePending = true,
    includeIgnored = false,
    limit = 200,
    includeNotes = true,
    notesLimit = 3,
    timeZone = "America/New_York",
    now = new Date(),
  } = {}
) {
  const rows = listAssignments(db, {
    status: "missing",
    includeIgnored,
    includePending,
    limit,
    timeZone,
    now,
  });
  const keys = rows.map((row) => row.key);
  const notesByKey = includeNotes ? listAssignmentNotes(db, { keys, limitPerAssignment: notesLimit }) : new Map();
  const actionable = [];
  const pending = [];

  for (const row of rows) {
    const notes = notesByKey.get(row.key) || [];
    const item = toSummaryItem(row, notes);
    if (row.statusCategory === "pending") {
      if (includePending) pending.push(item);
    } else {
      actionable.push(item);
    }
  }

  return {
    actionable,
    pending,
    total: rows.length,
  };
}

export function buildLegacySummary(dbSummary) {
  const currentMissing = [...(dbSummary.actionable || []), ...(dbSummary.pending || [])];
  return {
    currentMissing,
    newMissing: [],
    resolvedSince: [],
  };
}
