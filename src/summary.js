import { listAssignments } from "./db.js";

function toSummaryItem(row) {
  return {
    key: row.key,
    course: row.course || "",
    title: row.title || "",
    dueDate: row.dueDate || "",
    status: row.effectiveStatus || row.status || "",
    manualStatus: row.manualStatus || "",
    url: row.url || "",
    statusCategory: row.statusCategory || "",
  };
}

export function buildDbSummary(
  db,
  { includePending = true, includeIgnored = false, limit = 200 } = {}
) {
  const rows = listAssignments(db, {
    status: "missing",
    includeIgnored,
    includePending,
    limit,
  });
  const actionable = [];
  const pending = [];

  for (const row of rows) {
    const item = toSummaryItem(row);
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
