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
import {
  formatDateTime,
  formatDateTimeLabel,
  formatIsoWithOffset,
  parseReminderTime,
} from "./time.js";

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

function addLocalReminderFields(item, timeZone) {
  if (!item || !item.remindAt) {
    return {
      ...item,
      remindAtUtc: item?.remindAt || null,
      remindAtLocal: null,
      remindAtLabel: null,
      remindAtTz: timeZone,
    };
  }
  const parsed = new Date(item.remindAt);
  if (!Number.isFinite(parsed.getTime())) {
    return {
      ...item,
      remindAtUtc: item?.remindAt || null,
      remindAtLocal: null,
      remindAtLabel: null,
      remindAtTz: timeZone,
    };
  }
  const localIso = formatIsoWithOffset(parsed, timeZone);
  const utcIso = parsed.toISOString().replace(".000Z", "Z");
  return {
    ...item,
    remindAtUtc: utcIso,
    remindAt: localIso,
    remindAtLocal: formatDateTime(parsed, timeZone),
    remindAtLabel: formatDateTimeLabel(parsed, timeZone),
    remindAtTz: timeZone,
  };
}

function addLocalReminderFieldsToList(items, timeZone) {
  if (!Array.isArray(items)) return [];
  return items.map((item) => addLocalReminderFields(item, timeZone));
}

function normalizeReminderArgs(args, timeZone) {
  const raw = args?.remindAt;
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return { args, assumption: null };
  }
  const parsed = parseReminderTime(raw, timeZone);
  if (!parsed.ok || !parsed.date) {
    return { args, assumption: null };
  }
  const iso = formatIsoWithOffset(parsed.date, timeZone);
  return {
    args: { ...args, remindAt: iso },
    assumption: parsed.assumption || null,
  };
}

export async function runToolByName(db, toolName, args) {
  const config = getConfig();
  const timeZone = config?.schedule?.timezone || "America/New_York";
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
      {
        const normalized = normalizeReminderArgs(args, timeZone);
        const result = scheduleReminder(db, normalized.args);
        if (result?.ok && normalized.args?.remindAt) {
          const enriched = addLocalReminderFields(
            { remindAt: normalized.args.remindAt },
            timeZone
          );
          result.remindAt = enriched.remindAt;
          result.remindAtUtc = enriched.remindAtUtc;
          result.remindAtLocal = enriched.remindAtLocal;
          result.remindAtLabel = enriched.remindAtLabel;
          result.remindAtTz = enriched.remindAtTz;
        }
        if (normalized.assumption) {
          result.assumption = normalized.assumption;
        }
        return result;
      }
    case "list_assignment_reminders":
      return {
        ok: true,
        timeZone,
        reminders: addLocalReminderFieldsToList(listReminders(db, args), timeZone),
      };
    case "update_assignment_reminder":
      {
        const normalized = normalizeReminderArgs(args, timeZone);
        const result = updateReminder(db, normalized.args);
        if (result?.ok && result.reminder) {
          result.reminder = addLocalReminderFields(result.reminder, timeZone);
        }
        if (normalized.assumption) {
          result.assumption = normalized.assumption;
        }
        return result;
      }
    case "delete_assignment_reminder":
      return deleteReminder(db, args);
    case "create_task":
      {
        const normalized = normalizeReminderArgs(args, timeZone);
        const result = createTask(db, normalized.args);
        if (result?.ok && result.remindAt) {
          const enriched = addLocalReminderFields(
            { remindAt: result.remindAt },
            timeZone
          );
          return {
            ...result,
            remindAt: enriched.remindAt,
            remindAtUtc: enriched.remindAtUtc,
            remindAtLocal: enriched.remindAtLocal,
            remindAtLabel: enriched.remindAtLabel,
            remindAtTz: enriched.remindAtTz,
          };
        }
        if (normalized.assumption) {
          result.assumption = normalized.assumption;
        }
        return result;
      }
    case "list_tasks":
      return { ok: true, timeZone, tasks: addLocalReminderFieldsToList(listTasks(db, args), timeZone) };
    case "update_task_status":
      {
        const result = updateTaskStatus(db, args);
        if (result?.ok && result.task) {
          result.task = addLocalReminderFields(result.task, timeZone);
        }
        return result;
      }
    case "update_task":
      {
        const normalized = normalizeReminderArgs(args, timeZone);
        const result = updateTask(db, normalized.args);
        if (result?.ok && result.task) {
          result.task = addLocalReminderFields(result.task, timeZone);
        }
        if (normalized.assumption) {
          result.assumption = normalized.assumption;
        }
        return result;
      }
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
        const submittedArchivedCount = ignoredRows.filter((row) => {
          const text = `${row.effectiveStatus || ""} ${row.status || ""} ${row.rawText || ""}`.toLowerCase();
          return (
            text.includes("submitted, awaiting grade") ||
            text.includes("submission that has not been graded") ||
            text.includes("assignment submitted")
          );
        }).length;
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
          submittedArchivedCount,
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
      return await openBugReport(config, args);
    case "open_feature_request":
      return await openFeatureRequest(config, args);
    default:
      return { ok: false, error: `Unknown tool: ${toolName}` };
  }
}
