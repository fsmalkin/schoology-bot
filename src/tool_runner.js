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
  updateAssignmentStatusesByFilter,
  normalizeRecurrenceKind,
  updateReminder,
  updateTask,
  updateTaskStatus,
  scheduleReminder,
} from "./db.js";
import { openBugReport, openFeatureRequest } from "./bugs.js";
import { isIgnoredStatus, isPendingStatus } from "./statuses.js";
import { buildDailySummaryText, runReminders, runScrape } from "./tasks.js";
import {
  formatDateTime,
  formatDateTimeLabel,
  formatIsoWithOffset,
  getLocalDateTimeParts,
  makeDateInZoneParts,
  parseReminderTime,
} from "./time.js";
import { applyReminderAssumptions } from "./reminder_assumptions.js";
import { addLocalReminderFields, addLocalReminderFieldsToList } from "./reminder_view.js";

export const TOOL_NAMES = [
  "list_assignments",
  "update_assignment_status",
  "bulk_update_assignment_statuses",
  "bulk_update_assignments_by_filter",
  "apply_numbered_statuses",
  "add_assignment_note",
  "schedule_reminder",
  "list_assignment_reminders",
  "update_assignment_reminder",
  "delete_assignment_reminder",
  "refresh_schoology",
  "build_daily_summary",
  "drain_due_reminders",
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

function assumptionFromTimeParse(note, remindAt, timeZone) {
  const parsed = new Date(remindAt);
  if (!Number.isFinite(parsed.getTime())) {
    return {
      field: "remindAt",
      kind: "time_parse",
      reason: note,
      value: remindAt,
      valueLabel: remindAt,
    };
  }
  return {
    field: "remindAt",
    kind: "time_parse",
    reason: note,
    value: remindAt,
    valueLabel: formatDateTimeLabel(parsed, timeZone),
  };
}

function hasDateCue(text) {
  const value = String(text || "").trim();
  if (!value) return false;
  return (
    /\b(today|tomorrow|tonight|next|this)\b/i.test(value) ||
    /\b(mon(day)?|tue(s(day)?)?|wed(nesday)?|thu(rs(day)?)?|fri(day)?|sat(urday)?|sun(day)?)\b/i.test(value) ||
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)(uary|ruary|ch|il|e|y|ust|tember|ober|ember)?\b/i.test(
      value
    ) ||
    /\b\d{4}-\d{2}-\d{2}\b/.test(value) ||
    /\b\d{1,2}[/-]\d{1,2}([/-]\d{2,4})?\b/.test(value)
  );
}

function hasValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function resolveNow(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  if (value !== undefined && value !== null && String(value).trim() !== "") {
    const parsed = new Date(String(value));
    if (Number.isFinite(parsed.getTime())) return parsed;
  }
  return new Date();
}

function combineDateWithDefaultTime({ dateLike, timeLike, timeZone }) {
  const date = new Date(dateLike);
  const time = new Date(timeLike);
  if (!Number.isFinite(date.getTime()) || !Number.isFinite(time.getTime())) return null;
  const dateParts = getLocalDateTimeParts(date, timeZone);
  const timeParts = getLocalDateTimeParts(time, timeZone);
  if (!dateParts || !timeParts) return null;
  return makeDateInZoneParts(
    {
      year: dateParts.year,
      month: dateParts.month,
      day: dateParts.day,
      hour: timeParts.hour,
      minute: timeParts.minute,
    },
    timeZone
  );
}

function normalizeReminderArgs(args, timeZone, options = {}) {
  const nextArgs = args && typeof args === "object" ? { ...args } : {};
  const assumptions = [];
  const warnings = [];
  const userText = String(options?.userText || "");

  const hasExplicitTimeInUserText = (() => {
    if (!userText.trim()) return false;
    if (
      /\b\d{1,2}(:\d{2})?\s*(am|pm)\b/i.test(userText) ||
      /\bat\s+\d{1,2}(:\d{2})?\b/i.test(userText) ||
      /\b(noon|midnight)\b/i.test(userText)
    ) {
      return true;
    }
    return false;
  })();

  const inferred = applyReminderAssumptions({
    args: nextArgs,
    userText,
    timeZone,
    now: resolveNow(options?.now),
    allowCreateDefaults: options?.allowCreateDefaults === true,
  });
  if (inferred?.error) {
    return {
      args: inferred.args || nextArgs,
      assumptions,
      warnings,
      assumption: null,
      error: inferred.error,
    };
  }
  if (Array.isArray(inferred?.assumptions) && inferred.assumptions.length > 0) {
    assumptions.push(...inferred.assumptions);
  }
  if (Array.isArray(inferred?.warnings) && inferred.warnings.length > 0) {
    warnings.push(...inferred.warnings);
  }
  const mergedArgs = inferred?.args && typeof inferred.args === "object" ? inferred.args : nextArgs;
  const recurrenceCheck = normalizeRecurrenceKind(mergedArgs?.recurrence, { allowNull: true });
  const recurrenceKind = recurrenceCheck.ok ? recurrenceCheck.value || "none" : "none";

  if (
    options?.allowCreateDefaults !== true &&
    userText.trim() &&
    !hasExplicitTimeInUserText &&
    mergedArgs?.remindAt !== undefined &&
    mergedArgs?.remindAt !== null &&
    String(mergedArgs.remindAt).trim() !== ""
  ) {
    delete mergedArgs.remindAt;
    assumptions.push({
      field: "remindAt",
      kind: "ignored_model_time",
      reason:
        "The user did not provide an explicit time, so a model-supplied reminder time update was ignored.",
    });
    warnings.push("Ignored model-supplied reminder time because the user did not provide an explicit time.");
  }

  if (
    options?.allowCreateDefaults === true &&
    recurrenceKind !== "none" &&
    !hasExplicitTimeInUserText &&
    mergedArgs?.remindAt !== undefined &&
    mergedArgs?.remindAt !== null &&
    String(mergedArgs.remindAt).trim() !== ""
  ) {
    const originalRemindAt = String(mergedArgs.remindAt);
    const originalParsed = parseReminderTime(originalRemindAt, timeZone, resolveNow(options?.now));
    const shouldPreserveDate =
      hasDateCue(originalRemindAt) &&
      originalParsed?.ok === true &&
      originalParsed?.date instanceof Date &&
      Number.isFinite(originalParsed.date.getTime());

    mergedArgs.remindAt = null;
    const fallbackAssumed = applyReminderAssumptions({
      args: mergedArgs,
      userText,
      timeZone,
      now: resolveNow(options?.now),
      allowCreateDefaults: true,
    });
    if (fallbackAssumed?.error) {
      return {
        args: mergedArgs,
        assumptions,
        warnings,
        assumption: assumptions[0]?.reason || null,
        error: fallbackAssumed.error,
      };
    }
    if (fallbackAssumed?.args && typeof fallbackAssumed.args === "object") {
      Object.assign(mergedArgs, fallbackAssumed.args);
    }

    if (shouldPreserveDate && hasValue(mergedArgs.remindAt)) {
      const preserved = combineDateWithDefaultTime({
        dateLike: originalParsed.date,
        timeLike: mergedArgs.remindAt,
        timeZone,
      });
      if (preserved && Number.isFinite(preserved.getTime())) {
        mergedArgs.remindAt = formatIsoWithOffset(preserved, timeZone);
      }
    }

    if (Array.isArray(fallbackAssumed?.assumptions) && fallbackAssumed.assumptions.length > 0) {
      const adjustedAssumptions = fallbackAssumed.assumptions.map((entry) => {
        if (
          entry &&
          typeof entry === "object" &&
          entry.field === "remindAt" &&
          entry.kind === "default_time" &&
          hasValue(mergedArgs.remindAt)
        ) {
          const parsedValue = new Date(mergedArgs.remindAt);
          if (Number.isFinite(parsedValue.getTime())) {
            return {
              ...entry,
              value: mergedArgs.remindAt,
              valueLabel: formatDateTimeLabel(parsedValue, timeZone),
            };
          }
        }
        return entry;
      });
      assumptions.push(...adjustedAssumptions);
    }
    if (Array.isArray(fallbackAssumed?.warnings) && fallbackAssumed.warnings.length > 0) {
      warnings.push(...fallbackAssumed.warnings);
    }
  }

  const raw = mergedArgs?.remindAt;
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    const recurrenceRaw = mergedArgs?.recurrence;
    if (recurrenceRaw !== undefined && recurrenceRaw !== null && String(recurrenceRaw).trim() !== "") {
      const recurrence = normalizeRecurrenceKind(recurrenceRaw);
      if (recurrence.ok) mergedArgs.recurrence = recurrence.value;
    }
    return {
      args: mergedArgs,
      assumption: assumptions[0]?.reason || null,
      assumptions,
      warnings,
      error: null,
    };
  }

  const parsed = parseReminderTime(raw, timeZone, resolveNow(options?.now));
  let assumption = assumptions[0]?.reason || null;
  if (parsed.ok && parsed.date) {
    mergedArgs.remindAt = formatIsoWithOffset(parsed.date, timeZone);
    if (parsed.assumption) {
      assumptions.push(assumptionFromTimeParse(parsed.assumption, mergedArgs.remindAt, timeZone));
      assumption = parsed.assumption;
    }
  } else if (!parsed.ok) {
    return {
      args: mergedArgs,
      assumption,
      assumptions,
      warnings,
      error: parsed.error || "Reminder time is invalid.",
    };
  }

  const recurrenceRaw = mergedArgs?.recurrence;
  if (recurrenceRaw !== undefined && recurrenceRaw !== null && String(recurrenceRaw).trim() !== "") {
    const recurrence = normalizeRecurrenceKind(recurrenceRaw);
    if (recurrence.ok) {
      mergedArgs.recurrence = recurrence.value;
    } else {
      return {
        args: mergedArgs,
        assumption,
        assumptions,
        warnings,
        error: recurrence.error,
      };
    }
  }

  return {
    args: mergedArgs,
    assumption,
    assumptions,
    warnings,
    error: null,
  };
}

function attachAssumptions(result, normalized) {
  if (!result || !normalized) return result;
  const assumptions = Array.isArray(normalized.assumptions) ? normalized.assumptions : [];
  const warnings = Array.isArray(normalized.warnings) ? normalized.warnings : [];
  if (assumptions.length > 0) {
    result.assumptions = assumptions;
    if (!result.assumption && assumptions[0]?.reason) {
      result.assumption = assumptions[0].reason;
    }
  } else if (normalized.assumption) {
    result.assumption = normalized.assumption;
  }
  if (warnings.length > 0) {
    result.warnings = warnings;
  }
  return result;
}

function enrichSingleReminderResult(result, reminderLike, timeZone) {
  const enriched = addLocalReminderFields(reminderLike, timeZone);
  result.reminder = enriched;
  result.remindAt = enriched.remindAt;
  result.remindAtUtc = enriched.remindAtUtc;
  result.remindAtLocal = enriched.remindAtLocal;
  result.remindAtLabel = enriched.remindAtLabel;
  result.remindAtTz = enriched.remindAtTz;
  result.recurrenceKind = enriched.recurrenceKind;
  result.recurrenceLabel = enriched.recurrenceLabel;
  return result;
}

export async function runToolByName(db, toolName, args, context = {}) {
  const config = getConfig();
  const timeZone = config?.schedule?.timezone || "America/New_York";
  switch (toolName) {
    case "list_assignments":
      return {
        ok: true,
        assignments: listAssignments(db, {
          ...(args || {}),
          timeZone,
          now: context?.now,
        }),
      };
    case "update_assignment_status":
      return updateAssignmentStatus(db, args);
    case "bulk_update_assignment_statuses":
      return updateAssignmentStatuses(db, args.updates || []);
    case "bulk_update_assignments_by_filter":
      return updateAssignmentStatusesByFilter(db, args || {}, {
        timeZone,
        now: context?.now,
        userText: context?.userText,
      });
    case "apply_numbered_statuses":
      return applyNumberedStatuses(db, args);
    case "add_assignment_note":
      return addAssignmentNote(db, args);
    case "schedule_reminder":
      {
        const normalized = normalizeReminderArgs(args, timeZone, {
          userText: context?.userText || "",
          now: context?.now,
          allowCreateDefaults: true,
        });
        if (normalized.error) {
          return attachAssumptions({ ok: false, error: normalized.error }, normalized);
        }
        const result = scheduleReminder(db, normalized.args);
        if (result?.ok) {
          enrichSingleReminderResult(
            result,
            result?.reminder || {
              remindAt: normalized.args?.remindAt,
              recurrenceKind: normalized.args?.recurrence,
            },
            timeZone
          );
        }
        return attachAssumptions(result, normalized);
      }
    case "list_assignment_reminders":
      return {
        ok: true,
        timeZone,
        reminders: addLocalReminderFieldsToList(listReminders(db, args), timeZone),
      };
    case "update_assignment_reminder":
      {
        const normalized = normalizeReminderArgs(args, timeZone, {
          userText: context?.userText || "",
          now: context?.now,
          allowCreateDefaults: false,
        });
        if (normalized.error) {
          return attachAssumptions({ ok: false, error: normalized.error }, normalized);
        }
        const result = updateReminder(db, normalized.args);
        if (result?.ok && result.reminder) {
          result.reminder = addLocalReminderFields(result.reminder, timeZone);
          result.recurrenceKind = result.reminder.recurrenceKind;
          result.recurrenceLabel = result.reminder.recurrenceLabel;
        }
        return attachAssumptions(result, normalized);
      }
    case "delete_assignment_reminder":
      return deleteReminder(db, args);
    case "create_task":
      {
        const normalized = normalizeReminderArgs(args, timeZone, {
          userText: context?.userText || "",
          now: context?.now,
          allowCreateDefaults: true,
        });
        if (normalized.error) {
          return attachAssumptions({ ok: false, error: normalized.error }, normalized);
        }
        const result = createTask(db, normalized.args);
        if (result?.ok && result.remindAt) {
          const enriched = addLocalReminderFields(
            {
              remindAt: result.remindAt,
              recurrenceKind: result.recurrenceKind || normalized.args?.recurrence,
            },
            timeZone
          );
          return attachAssumptions(
            {
            ...result,
            remindAt: enriched.remindAt,
            remindAtUtc: enriched.remindAtUtc,
            remindAtLocal: enriched.remindAtLocal,
            remindAtLabel: enriched.remindAtLabel,
            remindAtTz: enriched.remindAtTz,
            recurrenceKind: enriched.recurrenceKind,
            recurrenceLabel: enriched.recurrenceLabel,
            },
            normalized
          );
        }
        return attachAssumptions(result, normalized);
      }
    case "list_tasks":
      return { ok: true, timeZone, tasks: addLocalReminderFieldsToList(listTasks(db, args), timeZone) };
    case "update_task_status":
      {
        const result = updateTaskStatus(db, args);
        if (result?.ok && result.task) {
          result.task = addLocalReminderFields(result.task, timeZone);
          result.recurrenceKind = result.task.recurrenceKind;
          result.recurrenceLabel = result.task.recurrenceLabel;
        }
        return result;
      }
    case "update_task":
      {
        const normalized = normalizeReminderArgs(args, timeZone, {
          userText: context?.userText || "",
          now: context?.now,
          allowCreateDefaults: false,
        });
        if (normalized.error) {
          return attachAssumptions({ ok: false, error: normalized.error }, normalized);
        }
        const result = updateTask(db, normalized.args);
        if (result?.ok && result.task) {
          result.task = addLocalReminderFields(result.task, timeZone);
          result.recurrenceKind = result.task.recurrenceKind;
          result.recurrenceLabel = result.task.recurrenceLabel;
        }
        return attachAssumptions(result, normalized);
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
    case "build_daily_summary": {
      try {
        const stateOverride =
          args?.state && typeof args.state === "object" && !Array.isArray(args.state)
            ? args.state
            : undefined;
        const built = await buildDailySummaryText({
          config,
          dbOverride: db,
          stateOverride,
          includeOptionalNotes: false,
          allowScrapeFallback: false,
          now: args?.now ? new Date(String(args.now)) : undefined,
        });
        return {
          ok: true,
          summaryText: built.summaryText,
          actionableCount: built.summary?.actionable?.length || 0,
          pendingCount: built.summary?.pending?.length || 0,
          reminderTodayCount: built.reminders?.today?.length || 0,
          reminderOverdueCount: built.reminders?.overdue?.length || 0,
          reminderUpcomingCount: built.reminders?.upcoming?.length || 0,
          lastScrapeAt: built.state?.lastScrapeAt || null,
          generatedAt: new Date().toISOString(),
        };
      } catch (err) {
        return { ok: false, error: err?.message || String(err) };
      }
    }
    case "drain_due_reminders": {
      try {
        const captured = [];
        const result = await runReminders({
          config,
          dbOverride: db,
          nowOverride: args?.now ? String(args.now) : undefined,
          senders: {
            telegramRaw: async (_cfg, text) => {
              captured.push(String(text || ""));
            },
          },
        });
        return {
          ok: true,
          count: captured.length,
          messages: captured,
          now: args?.now || null,
          result: result || null,
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
