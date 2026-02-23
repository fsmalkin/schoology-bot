import { parseSchoologyDate } from "./time.js";
import { normalizeAscii } from "./text_utils.js";

const MAX_SECTION_ITEMS = 5;
const DEFAULT_TIME_ZONE = "America/New_York";

function toTimeZone(value) {
  const raw = String(value || "").trim();
  return raw || DEFAULT_TIME_ZONE;
}

function isValidDate(value) {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function asDate(value) {
  if (value instanceof Date) return isValidDate(value) ? value : null;
  if (value === null || value === undefined || value === "") return null;
  const parsed = new Date(value);
  return isValidDate(parsed) ? parsed : null;
}

function formatDayDate(date, timeZone) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: toTimeZone(timeZone),
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function formatDayDateTime(date, timeZone, includeZone = false) {
  const options = {
    timeZone: toTimeZone(timeZone),
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  };
  if (includeZone) {
    options.timeZoneName = "short";
  }
  return new Intl.DateTimeFormat("en-US", options).format(date);
}

export function simplifyCourseName(name) {
  const raw = String(name || "").replace(/\s+/g, " ").trim();
  if (!raw) return "Other";
  const base = raw.split(":")[0].trim();
  return base.replace(/Course$/i, "").trim() || "Other";
}

function normalizeKey(value) {
  return String(value || "").trim().toLowerCase();
}

function assignmentIdentity(course, title) {
  return `${normalizeKey(simplifyCourseName(course))}|${normalizeKey(title)}`;
}

function assignmentIdentityFromTask(task) {
  const title = String(task?.title || "").trim();
  if (!title.includes(" - ")) return null;
  const pieces = title.split(" - ");
  const course = pieces.shift();
  const assignmentTitle = pieces.join(" - ").trim();
  if (!course || !assignmentTitle) return null;
  return assignmentIdentity(course, assignmentTitle);
}

export function formatFriendlyStatus(status) {
  const official = String(status || "").trim();
  if (!official) return "Needs action";
  const lower = official.toLowerCase();
  if (lower === "waiting on teacher") {
    return "Needs teacher reply (Waiting on teacher)";
  }
  if (lower === "no grade put in yet") {
    return "Grade not posted yet (No grade put in yet)";
  }
  if (lower === "absent") {
    return "Needs fix now (Absent)";
  }
  if (lower === "missing") {
    return "Turn in missing work (Missing)";
  }
  if (lower === "incomplete") {
    return "Finish and resubmit (Incomplete)";
  }
  return `Needs action (${official})`;
}

function formatDueLabel(dueDate, timeZone, nowDate) {
  const raw = String(dueDate || "").trim();
  if (!raw) return "Due date not shown";
  const parsed = parseSchoologyDate(raw, timeZone) || asDate(raw);
  if (!parsed) return `Due ${raw}`;
  const label = formatDayDateTime(parsed, timeZone, false);
  if (parsed < nowDate) {
    return `Overdue since ${label}`;
  }
  return `Due ${label}`;
}

function buildAssignmentItem(item, { timeZone, nowDate, includeLink }) {
  const course = simplifyCourseName(item?.course);
  const title = String(item?.title || "Untitled assignment");
  const status = formatFriendlyStatus(item?.manualStatus || item?.status || item?.effectiveStatus || "");
  const due = formatDueLabel(item?.dueDate, timeZone, nowDate);
  const line = `[${course}] ${title} | ${due} | ${status}`;
  const link = includeLink && item?.url ? String(item.url).trim() : "";
  return link ? { line, link } : { line };
}

function buildReminderActionText(task) {
  const title = String(task?.title || "").trim();
  const message = String(task?.message || "").trim();
  if (!title && !message) return "Check Schoology";
  if (!message) return title || "Reminder";
  if (/^auto reminder for upcoming due date/i.test(message)) {
    return title ? `Work on ${title}` : "Work on upcoming assignment";
  }
  if (!title) return message;
  if (message.toLowerCase().includes(title.toLowerCase())) return message;
  return `${title}: ${message}`;
}

function buildReminderItem(task, timeZone) {
  const action = buildReminderActionText(task);
  const remindAt = asDate(task?.remindAt);
  const when = remindAt ? formatDayDateTime(remindAt, timeZone, false) : "No time set";
  return { line: `${action} | ${when}` };
}

function normalizeSectionItems(items) {
  const out = [];
  const seen = new Set();
  for (const item of items || []) {
    if (!item || !item.line) continue;
    const line = String(item.line).trim();
    if (!line) continue;
    const link = item.link ? String(item.link).trim() : "";
    const key = `${line}|${link}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(link ? { line, link } : { line });
  }
  return out;
}

function pushSection(lines, title, items) {
  const normalized = normalizeSectionItems(items);
  if (normalized.length === 0) return false;
  lines.push(title);
  const shown = normalized.slice(0, MAX_SECTION_ITEMS);
  for (const item of shown) {
    lines.push(`- ${item.line}`);
    if (item.link) {
      lines.push(`  Link: ${item.link}`);
    }
  }
  if (normalized.length > MAX_SECTION_ITEMS) {
    lines.push(`- ...and ${normalized.length - MAX_SECTION_ITEMS} more`);
  }
  lines.push("");
  return true;
}

function parseArguments(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (err) {
    return {};
  }
}

function normalizeSchoologyIdp(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "auto";
  if (["microsoft", "ms", "office365", "azuread", "aad"].includes(raw)) return "microsoft";
  if (raw === "google") return "google";
  if (["schoology", "local", "adfs", "auto"].includes(raw)) return raw;
  return raw;
}

function schoologyIdpLabel(value) {
  const idp = normalizeSchoologyIdp(value);
  if (idp === "microsoft") return "Microsoft (BCPS / Office 365)";
  if (idp === "google") return "Google";
  if (idp === "schoology") return "Schoology";
  if (idp === "local" || idp === "adfs") return "District SSO";
  return "";
}

function formatRefreshSchoologyError(error, schoologyIdp) {
  const message = String(error || "").trim();
  if (!message) return "Need your input: refresh failed.";
  if (!/login failed/i.test(message)) return `Need your input: ${message}`;

  const configured = schoologyIdpLabel(schoologyIdp);
  if (configured) {
    return `Schoology login failed using configured ${configured} sign-in. I will retry; no provider selection is needed.`;
  }
  return "Schoology login failed. Reply with your sign-in provider (Microsoft, Google, or Other).";
}

function assignmentInlineLabel(assignment, args = {}) {
  const source = assignment && typeof assignment === "object" ? assignment : {};
  const course = simplifyCourseName(source.course || args.course || "");
  const title = String(source.title || args.title || "").trim();
  if (title) return `[${course}] ${title}`;
  if (args.key) return `assignment ${args.key}`;
  return "assignment";
}

function formatReminderLabel(remindAt, timeZone) {
  const parsed = asDate(remindAt);
  if (!parsed) return "";
  return formatDayDateTime(parsed, timeZone, false);
}

function recurrenceLabel(kind) {
  const normalized = String(kind || "").trim().toLowerCase();
  if (normalized === "daily") return "Daily";
  if (normalized === "weekdays") return "Weekdays";
  if (normalized === "weekly") return "Weekly";
  return "One-time";
}

function formatReminderWhen(remindAt, remindAtLabel, recurrenceKind, recurrenceLabelText, timeZone) {
  const when = String(remindAtLabel || "").trim() || formatReminderLabel(remindAt, timeZone);
  const cadence = recurrenceLabelText || recurrenceLabel(recurrenceKind);
  if (!when) return cadence === "One-time" ? "" : cadence;
  if (cadence === "One-time") return when;
  return `${when} (${cadence})`;
}

function collectAssumptionItems(output) {
  const assumptions = Array.isArray(output?.assumptions) ? output.assumptions : [];
  const items = [];
  for (const assumption of assumptions) {
    const reason = String(assumption?.reason || "").trim();
    const label = String(assumption?.valueLabel || assumption?.value || "").trim();
    if (!reason) continue;
    if (label) {
      items.push(makeItem(`Assumed ${assumption?.field || "value"}: ${label}. ${reason}`));
    } else {
      items.push(makeItem(`Assumption: ${reason}`));
    }
  }
  for (const warning of Array.isArray(output?.warnings) ? output.warnings : []) {
    const line = String(warning || "").trim();
    if (!line) continue;
    items.push(makeItem(line));
  }
  return items.filter(Boolean);
}

function pushAssumptionsAndCorrection(info, output, correctionExample) {
  const assumptionItems = collectAssumptionItems(output);
  for (const item of assumptionItems) {
    info.push(item);
  }
  if (assumptionItems.length > 0 && correctionExample) {
    info.push(makeItem(`Quick edit: ${correctionExample}`));
  }
}

function makeItem(line, link = "") {
  const trimmed = String(line || "").trim();
  if (!trimmed) return null;
  if (link) return { line: trimmed, link: String(link).trim() };
  return { line: trimmed };
}

function listPendingRowsFromDb(db) {
  if (!db || typeof db.prepare !== "function") return [];
  const rows = db
    .prepare(
      `
      SELECT
        course,
        title,
        due_date AS dueDate,
        status,
        manual_status AS manualStatus,
        url,
        raw_text AS rawText,
        auto_ignored AS autoIgnored
      FROM assignments
      WHERE is_missing = 1
      ORDER BY LOWER(course), due_date, LOWER(title)
    `
    )
    .all();

  const isPendingStatus = (value) => {
    const lower = String(value || "").trim().toLowerCase();
    return lower === "no grade put in yet" || lower === "waiting on teacher";
  };

  const isSubmittedUngraded = (row) => {
    const text = `${row?.status || ""} ${row?.rawText || ""}`.toLowerCase();
    return (
      text.includes("submitted, awaiting grade") ||
      text.includes("submission that has not been graded") ||
      text.includes("assignment submitted")
    );
  };

  return rows.filter((row) => {
    if (Number(row?.autoIgnored || 0) === 1) return false;
    if (isSubmittedUngraded(row)) return false;
    return isPendingStatus(row?.manualStatus);
  });
}

export function buildReadableDailySummary({ summary, reminders, state, timeZone, now } = {}) {
  const tz = toTimeZone(timeZone);
  const nowDate = asDate(now) || new Date();
  const actionable = Array.isArray(summary?.actionable) ? summary.actionable : [];
  const pending = Array.isArray(summary?.pending) ? summary.pending : [];
  const reminderToday = Array.isArray(reminders?.today) ? reminders.today : [];
  const reminderOverdue = Array.isArray(reminders?.overdue) ? reminders.overdue : [];
  const reminderUpcoming = Array.isArray(reminders?.upcoming) ? reminders.upcoming : [];

  const knownAssignments = new Set();
  for (const item of [...actionable, ...pending]) {
    knownAssignments.add(assignmentIdentity(item?.course, item?.title));
  }

  const doNowItems = actionable.map((item) =>
    buildAssignmentItem(item, { timeZone: tz, nowDate, includeLink: true })
  );

  for (const task of [...reminderOverdue, ...reminderToday]) {
    const identity = assignmentIdentityFromTask(task);
    if (identity && knownAssignments.has(identity)) continue;
    doNowItems.push(buildReminderItem(task, tz));
  }

  const soonItems = [];
  for (const task of reminderUpcoming) {
    const identity = assignmentIdentityFromTask(task);
    if (identity && knownAssignments.has(identity)) continue;
    soonItems.push(buildReminderItem(task, tz));
  }

  const waitingItems = pending.map((item) =>
    buildAssignmentItem(item, { timeZone: tz, nowDate, includeLink: false })
  );

  const lines = [];
  lines.push(`Schoology Summary | ${formatDayDate(nowDate, tz)}`);
  const lastScrape = asDate(state?.lastScrapeAt);
  if (lastScrape) {
    lines.push(`Last checked: ${formatDayDateTime(lastScrape, tz, true)}`);
  }
  lines.push("");

  let hasSection = false;
  hasSection = pushSection(lines, "Do Now", doNowItems) || hasSection;
  hasSection = pushSection(lines, "Soon", soonItems) || hasSection;
  hasSection = pushSection(lines, "Waiting", waitingItems) || hasSection;

  if (!hasSection) {
    lines.push("Nothing to do right now.");
  }

  return normalizeAscii(lines.join("\n").trim());
}

export function buildReadableReminderMessage({ task, timeZone } = {}) {
  const tz = toTimeZone(timeZone);
  const item = buildReminderItem(task || {}, tz);
  const lines = ["Do Now", `- ${item.line}`];
  return normalizeAscii(lines.join("\n").trim());
}

export function buildReadableToolResponse({ executed, db, timeZone, now, schoologyIdp } = {}) {
  const tz = toTimeZone(timeZone);
  const nowDate = asDate(now) || new Date();
  const doneNow = [];
  const soon = [];
  const waiting = [];
  const info = [];

  for (const entry of Array.isArray(executed) ? executed : []) {
    const name = entry?.call?.name || "";
    const output = entry?.output || {};
    const args = parseArguments(entry?.call?.arguments);

    if ((name === "open_bug_report" || name === "open_feature_request") && output?.issue?.ok) {
      if (output.issue.url) info.push(makeItem(`Created issue: ${output.issue.url}`));
      continue;
    }
    if ((name === "open_bug_report" || name === "open_feature_request") && output?.logged) {
      info.push(makeItem(`Saved request locally (${output.logPath || "data/bugs.log"}).`));
      continue;
    }
    if ((name === "open_bug_report" || name === "open_feature_request") && output?.issue?.error) {
      doneNow.push(makeItem(`Need your input: ${output.issue.error}`));
      continue;
    }

    if (name === "schedule_reminder") {
      if (output?.ok) {
        const label = assignmentInlineLabel(output.assignment, args);
        const recurrenceKind = output.recurrenceKind || output?.reminder?.recurrenceKind || args.recurrence || "none";
        const recurrenceText = output.recurrenceLabel || recurrenceLabel(recurrenceKind);
        doneNow.push(
          makeItem(
            recurrenceKind && recurrenceKind !== "none"
              ? `Created recurring reminder for ${label}.`
              : `Saved reminder for ${label}.`
          )
        );
        const when = formatReminderWhen(
          output.remindAt || output?.reminder?.remindAt || args.remindAt,
          output.remindAtLabel || output?.reminder?.remindAtLabel || "",
          recurrenceKind,
          recurrenceText,
          tz
        );
        if (when) soon.push(makeItem(`${label} | ${when}`));
        if (output.deletedDuplicates) {
          info.push(makeItem(`Removed ${output.deletedDuplicates} duplicate reminder(s).`));
        }
        const reminderId = output?.reminder?.id || output?.reminderId || args.id || null;
        pushAssumptionsAndCorrection(
          info,
          output,
          reminderId
            ? `"move reminder #${reminderId} to tomorrow 4:30 PM"`
            : `"move that reminder to tomorrow 4:30 PM"`
        );
      } else if (output?.error) {
        doneNow.push(makeItem(`Need your input: ${output.error}`));
      }
      continue;
    }

    if (name === "update_assignment_reminder") {
      if (output?.ok) {
        const id = output?.reminder?.id || args.id || "reminder";
        doneNow.push(makeItem(`Updated reminder #${id}.`));
        const when = formatReminderWhen(
          output?.reminder?.remindAt || args.remindAt,
          output?.reminder?.remindAtLabel || "",
          output?.recurrenceKind || output?.reminder?.recurrenceKind || args.recurrence || "none",
          output?.recurrenceLabel || output?.reminder?.recurrenceLabel || "",
          tz
        );
        if (when) soon.push(makeItem(`Reminder #${id} | ${when}`));
        pushAssumptionsAndCorrection(info, output, `"update reminder #${id} to weekdays at 7:00 AM"`);
      } else if (output?.error) {
        doneNow.push(makeItem(`Need your input: ${output.error}`));
      }
      continue;
    }

    if (name === "delete_assignment_reminder") {
      if (output?.ok) {
        doneNow.push(makeItem(`Deleted reminder #${output.id || args.id}.`));
      } else if (output?.error) {
        doneNow.push(makeItem(`Need your input: ${output.error}`));
      }
      continue;
    }

    if (name === "refresh_schoology") {
      if (output?.ok) {
        const actionable = Number(output.actionableCount || 0);
        const pendingCount = Number(output.pendingCount || 0);
        const ignoredCount = Number(output.ignoredCount || 0);
        if (actionable > 0) {
          doneNow.push(makeItem(`${actionable} assignment(s) still need action.`));
        } else {
          doneNow.push(makeItem("No assignments need action right now."));
        }
        if (pendingCount > 0) {
          waiting.push(makeItem(`${pendingCount} item(s) are waiting on teacher/grade.`));
        }
        if (ignoredCount > 0) {
          info.push(makeItem(`${ignoredCount} item(s) were archived.`));
        }
        if (Number(output.submittedArchivedCount || 0) > 0) {
          info.push(
            makeItem(
              `${Number(output.submittedArchivedCount || 0)} archived item(s) were already submitted and awaiting grade.`
            )
          );
        }
      } else if (output?.error) {
        doneNow.push(makeItem(formatRefreshSchoologyError(output.error, schoologyIdp)));
      }
      continue;
    }

    if (name === "create_task") {
      if (output?.ok) {
        const title = String(output.title || args.title || `Task #${output.id}`).trim();
        const recurrenceKind = output.recurrenceKind || args.recurrence || "none";
        doneNow.push(
          makeItem(
            recurrenceKind !== "none"
              ? `Created recurring reminder task: ${title}.`
              : `Created reminder task: ${title}.`
          )
        );
        const when = formatReminderWhen(
          output.remindAt || args.remindAt,
          output.remindAtLabel || "",
          recurrenceKind,
          output.recurrenceLabel || "",
          tz
        );
        if (when) soon.push(makeItem(`${title} | ${when}`));
        pushAssumptionsAndCorrection(
          info,
          output,
          output?.id ? `"update task #${output.id} to 9:00 PM weekdays"` : `"update that task to 9:00 PM weekdays"`
        );
      } else if (output?.error) {
        doneNow.push(makeItem(`Need your input: ${output.error}`));
      }
      continue;
    }

    if (name === "update_task_status") {
      if (output?.ok) {
        const id = output?.task?.id || args.id || "task";
        const status = String(output?.task?.status || args.status || "updated").trim();
        doneNow.push(makeItem(`Updated task #${id} -> ${status}.`));
      } else if (output?.error) {
        doneNow.push(makeItem(`Need your input: ${output.error}`));
      }
      continue;
    }

    if (name === "update_task") {
      if (output?.ok) {
        const id = output?.task?.id || args.id || "task";
        const title = String(output?.task?.title || args.title || "").trim();
        if (title) {
          doneNow.push(makeItem(`Updated task #${id}: ${title}.`));
        } else {
          doneNow.push(makeItem(`Updated task #${id}.`));
        }
        const when = formatReminderWhen(
          output?.task?.remindAt || args.remindAt,
          output?.task?.remindAtLabel || "",
          output?.recurrenceKind || output?.task?.recurrenceKind || args.recurrence || "none",
          output?.recurrenceLabel || output?.task?.recurrenceLabel || "",
          tz
        );
        if (when) soon.push(makeItem(`Task #${id} | ${when}`));
        pushAssumptionsAndCorrection(info, output, `"update task #${id} to daily at 4:30 PM"`);
      } else if (output?.error) {
        doneNow.push(makeItem(`Need your input: ${output.error}`));
      }
      continue;
    }

    if (name === "delete_task") {
      if (output?.ok) {
        doneNow.push(makeItem(`Deleted task #${output.id || args.id}.`));
      } else if (output?.error) {
        doneNow.push(makeItem(`Need your input: ${output.error}`));
      }
      continue;
    }

    if (name === "add_assignment_note") {
      if (output?.ok) {
        const label = assignmentInlineLabel(output.assignment, args);
        doneNow.push(makeItem(`Added note to ${label}.`));
      } else if (output?.error) {
        doneNow.push(makeItem(`Need your input: ${output.error}`));
      }
      continue;
    }

    if (name === "update_assignment_status") {
      if (output?.ok) {
        const label = assignmentInlineLabel(output.assignment, args);
        const status = formatFriendlyStatus(output.status || args.status);
        doneNow.push(makeItem(`Updated ${label} -> ${status}.`));
      } else if (output?.matches?.length) {
        doneNow.push(makeItem(`Need your input: multiple matches for "${args.title || "assignment"}".`));
      } else if (output?.error) {
        doneNow.push(makeItem(`Need your input: ${output.error}`));
      }
      continue;
    }

    if (name === "bulk_update_assignment_statuses") {
      for (const row of Array.isArray(output?.results) ? output.results : []) {
        const result = row?.result || {};
        const input = row?.input || {};
        if (result?.ok) {
          const label = assignmentInlineLabel(result.assignment, input);
          const status = formatFriendlyStatus(result.status || input.status);
          doneNow.push(makeItem(`Updated ${label} -> ${status}.`));
        } else if (result?.matches?.length) {
          doneNow.push(makeItem(`Need your input: multiple matches for "${input.title || "assignment"}".`));
        } else if (result?.error) {
          doneNow.push(makeItem(`Need your input: ${result.error}`));
        }
      }
      continue;
    }

    if (name === "apply_numbered_statuses") {
      for (const row of Array.isArray(output?.results) ? output.results : []) {
        const result = row?.result || {};
        const fallback = row?.assignment || {};
        if (result?.ok) {
          const label = assignmentInlineLabel(result.assignment || fallback, {});
          const status = formatFriendlyStatus(result.status);
          doneNow.push(makeItem(`Updated ${label} -> ${status}.`));
        } else if (result?.error) {
          doneNow.push(makeItem(`Need your input: ${result.error}`));
        }
      }
      continue;
    }

    if (output?.error) {
      doneNow.push(makeItem(`Need your input: ${output.error}`));
    }
  }

  if (db) {
    const pendingRows = listPendingRowsFromDb(db);
    for (const row of pendingRows) {
      waiting.push(
        buildAssignmentItem(row, {
          timeZone: tz,
          nowDate,
          includeLink: false,
        })
      );
    }
  }

  const lines = [];
  const hasDoNow = pushSection(lines, "Do Now", doneNow);
  const hasSoon = pushSection(lines, "Soon", soon);
  const hasWaiting = pushSection(lines, "Waiting", waiting);
  pushSection(lines, "Info", info);

  if (!hasDoNow && !hasSoon && !hasWaiting && lines.length === 0) {
    return "Done.";
  }
  return normalizeAscii(lines.join("\n").trim() || "Done.");
}
