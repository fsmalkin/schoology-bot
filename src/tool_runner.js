import { getConfig } from "./config.js";
import {
  addAssignmentNote,
  listAssignments,
  listResolvedWithManualStatus,
  listReminders,
  listTasks,
  applyNumberedStatuses,
  clearManualStatuses,
  createTask,
  deleteReminder,
  deleteTask,
  updateAssignmentStatus,
  updateAssignmentStatuses,
  updateReminder,
  updateTask,
  updateTaskStatus,
  scheduleReminder,
} from "./db.js";
import { openBugReport, openFeatureRequest } from "./bugs.js";
import { isIgnoredStatus, isPendingStatus } from "./statuses.js";
import { runScrape } from "./tasks.js";

export const TOOL_NAMES = [
  "list_assignments",
  "update_assignment_status",
  "bulk_update_assignment_statuses",
  "apply_numbered_statuses",
  "add_assignment_note",
  "schedule_reminder",
  "list_assignment_reminders",
  "update_assignment_reminder",
  "delete_assignment_reminder",
  "refresh_schoology",
  "create_task",
  "list_tasks",
  "update_task_status",
  "update_task",
  "delete_task",
  "open_bug_report",
  "open_feature_request",
];

export function applyManualStatusPolicy(rows) {
  const cleared = [];
  const kept = [];
  for (const row of rows) {
    const hasNotes = Number(row.notesCount || 0) > 0;
    if (hasNotes) {
      kept.push({ ...row, reason: "Has notes" });
      continue;
    }
    if (isIgnoredStatus(row.manualStatus)) {
      cleared.push(row);
      continue;
    }
    if (isPendingStatus(row.manualStatus)) {
      kept.push({ ...row, reason: "Pending status" });
      continue;
    }
    kept.push({ ...row, reason: "Custom status" });
  }
  return { cleared, kept };
}

export async function runToolByName(db, toolName, args) {
  switch (toolName) {
    case "list_assignments":
      return { ok: true, assignments: listAssignments(db, args) };
    case "update_assignment_status":
      return updateAssignmentStatus(db, args);
    case "bulk_update_assignment_statuses":
      return updateAssignmentStatuses(db, args.updates || []);
    case "apply_numbered_statuses":
      return applyNumberedStatuses(db, args);
    case "add_assignment_note":
      return addAssignmentNote(db, args);
    case "schedule_reminder":
      return scheduleReminder(db, args);
    case "list_assignment_reminders":
      return { ok: true, reminders: listReminders(db, args) };
    case "update_assignment_reminder":
      return updateReminder(db, args);
    case "delete_assignment_reminder":
      return deleteReminder(db, args);
    case "create_task":
      return createTask(db, args);
    case "list_tasks":
      return { ok: true, tasks: listTasks(db, args) };
    case "update_task_status":
      return updateTaskStatus(db, args);
    case "update_task":
      return updateTask(db, args);
    case "delete_task":
      return deleteTask(db, args);
    case "refresh_schoology": {
      try {
        const { state } = await runScrape();
        const since = state?.lastScrapeAt || new Date().toISOString();
        const resolved = listResolvedWithManualStatus(db, since);
        const { cleared, kept } = applyManualStatusPolicy(resolved);
        const clearResult = clearManualStatuses(db, cleared.map((row) => row.key));
        const bucketed = listAssignments(db, {
          status: "missing",
          includeIgnored: true,
          includePending: true,
          bucketed: true,
          limit: 1000,
        });
        const actionableCount = bucketed?.buckets?.actionable?.length || 0;
        const pendingCount = bucketed?.buckets?.pending?.length || 0;
        const ignoredRows = bucketed?.buckets?.ignored || [];
        const ignoredCount = ignoredRows.length;
        const reasons = Array.from(
          new Set(
            ignoredRows
              .map((row) => row.autoIgnoreReason)
              .filter((value) => value && String(value).trim().length > 0)
          )
        ).slice(0, 3);
        return {
          ok: true,
          actionableCount,
          pendingCount,
          ignoredCount,
          ignoredReasons: reasons,
          resolvedCount: resolved.length,
          clearedManualCount: clearResult.cleared || 0,
          keptManual: kept,
        };
      } catch (err) {
        return { ok: false, error: err?.message || String(err) };
      }
    }
    case "open_bug_report":
      return await openBugReport(getConfig(), args);
    case "open_feature_request":
      return await openFeatureRequest(getConfig(), args);
    default:
      return { ok: false, error: `Unknown tool: ${toolName}` };
  }
}
