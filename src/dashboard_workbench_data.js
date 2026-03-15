import {
  ensureDbSeeded,
  getDb,
  listAssignmentNotes,
  listAssignments,
  listReminders,
  listTasks,
} from "./db.js";
import { STATUS_CODE_MAP, getManualStatusCategory } from "./statuses.js";
import { addLocalReminderFields, addLocalReminderFieldsToList, recurrenceOptionList } from "./reminder_view.js";
import { formatDateTimeLabel, formatDateYmd, parseSchoologyDate } from "./time.js";
import { deriveSchoologyAssignmentTitle } from "./text_utils.js";

const WORKBENCH_LIMIT = 1000;
const NOTES_PREVIEW_LIMIT = 2;

const PARENT_BUCKETS = {
  actionable: {
    id: "actionable",
    label: "Needs attention",
    homeLabel: "Needs Attention Tonight",
  },
  pending: {
    id: "pending",
    label: "Waiting on school",
    homeLabel: "Waiting on School",
  },
  ignored: {
    id: "ignored",
    label: "Handled for now",
    homeLabel: "Handled for Now",
  },
};

const MANUAL_STATUS_UI = {
  [STATUS_CODE_MAP.A]: {
    label: "Excused",
    category: "ignored",
    description: "Handled for now",
  },
  [STATUS_CODE_MAP.B]: {
    label: "Practice only",
    category: "ignored",
    description: "Handled for now",
  },
  [STATUS_CODE_MAP.C]: {
    label: "Let it go",
    category: "ignored",
    description: "Handled for now",
  },
  [STATUS_CODE_MAP.D]: {
    label: "Grade not posted yet",
    category: "pending",
    description: "Waiting on school",
  },
  [STATUS_CODE_MAP.E]: {
    label: "Waiting on teacher",
    category: "pending",
    description: "Waiting on school",
  },
};

const DASHBOARD_QUICK_ACTIONS = {
  submitted: { id: "submitted", label: "Submitted", kind: "composite" },
  waiting_on_teacher: { id: "waiting_on_teacher", label: "Waiting on teacher", kind: "status" },
  excused: { id: "excused", label: "Excused", kind: "status" },
  needs_follow_up: { id: "needs_follow_up", label: "Needs follow-up", kind: "composer" },
  add_note: { id: "add_note", label: "Add note", kind: "composer" },
  more: { id: "more", label: "More", kind: "menu" },
  mark_done: { id: "mark_done", label: "Done", kind: "status" },
  reopen: { id: "reopen", label: "Reopen", kind: "status" },
  edit_follow_up: { id: "edit_follow_up", label: "Edit", kind: "editor" },
  delete_follow_up: { id: "delete_follow_up", label: "Delete", kind: "destructive" },
};

export const DASHBOARD_ALLOWED_TOOL_NAMES = [
  "update_assignment_status",
  "bulk_update_assignment_statuses",
  "add_assignment_note",
  "schedule_reminder",
  "update_assignment_reminder",
  "delete_assignment_reminder",
  "refresh_schoology",
  "create_task",
  "update_task_status",
  "update_task",
  "delete_task",
];

function getDashboardDb(config, dbOverride = null) {
  const db = dbOverride || getDb(config);
  if (!dbOverride) {
    ensureDbSeeded(db, config.paths.statePath);
  }
  return db;
}

function normalizeStatusFilter(value) {
  const raw = String(value || "missing").trim().toLowerCase();
  return ["missing", "resolved", "all"].includes(raw) ? raw : "missing";
}

function normalizeTaskStatusFilter(value) {
  const raw = String(value || "pending").trim().toLowerCase();
  return ["pending", "done", "all"].includes(raw) ? raw : "pending";
}

function normalizeBoolean(value, defaultValue) {
  if (value === undefined || value === null || value === "") return defaultValue;
  if (typeof value === "boolean") return value;
  const raw = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(raw)) return true;
  if (["false", "0", "no", "off"].includes(raw)) return false;
  return defaultValue;
}

function mapNotesPreview(notes) {
  return (notes || []).map((entry) => ({
    note: entry.note || "",
    createdAt: entry.createdAt || null,
  }));
}

function mapDueDate(rawDueDate, timeZone) {
  const parsed = parseSchoologyDate(rawDueDate, timeZone);
  return {
    dueDate: rawDueDate || "",
    dueDateLabel: parsed ? formatDateTimeLabel(parsed, timeZone) : rawDueDate || "No due date",
    dueDateSort: parsed ? parsed.toISOString() : rawDueDate || "",
    dueDateYmd: parsed ? formatDateYmd(parsed, timeZone) : null,
    dueDateIso: parsed ? parsed.toISOString() : null,
  };
}

function isSubmittedUngraded(row) {
  const text = `${row.status || ""} ${row.rawText || ""}`.toLowerCase();
  return (
    text.includes("submitted, awaiting grade") ||
    text.includes("submission that has not been graded") ||
    text.includes("assignment submitted")
  );
}

function displayBucket(category, { inferredSubmittedUngraded = false } = {}) {
  if (inferredSubmittedUngraded) return PARENT_BUCKETS.pending;
  return PARENT_BUCKETS[category] || PARENT_BUCKETS.actionable;
}

function displayStatusLabel(row, inferredSubmittedUngraded) {
  if (row.manualStatus && MANUAL_STATUS_UI[row.manualStatus]) {
    return MANUAL_STATUS_UI[row.manualStatus].label;
  }
  if (inferredSubmittedUngraded) return "Submitted and awaiting grade";
  return row.effectiveStatus || row.status || "Needs review";
}

function bucketReasonText(row, inferredSubmittedUngraded, todayYmd) {
  if (inferredSubmittedUngraded) {
    return "Schoology shows this as submitted and still awaiting a grade.";
  }
  if (row.statusCategory === "pending") {
    if (row.manualStatus === STATUS_CODE_MAP.D) return "You marked this as waiting for a grade to post.";
    if (row.manualStatus === STATUS_CODE_MAP.E) return "You marked this as waiting on a teacher.";
    return "This is waiting on school follow-up.";
  }
  if (row.statusCategory === "ignored") {
    if (row.manualStatus && MANUAL_STATUS_UI[row.manualStatus]) {
      return `${MANUAL_STATUS_UI[row.manualStatus].label}.`;
    }
    if (row.autoIgnored) return "This was filed away automatically so it does not clutter tonight.";
    return "Handled for now.";
  }
  if (!row.dueDateYmd) return "This still needs attention.";
  if (row.dueDateYmd < todayYmd) return "The due date has already passed.";
  if (row.dueDateYmd === todayYmd) return "This is due today.";
  return `Due ${row.dueDateLabel}.`;
}

function groupRemindersByAssignment(reminders, timeZone) {
  const mapped = addLocalReminderFieldsToList(reminders, timeZone);
  const grouped = new Map();
  for (const reminder of mapped) {
    const key = String(reminder.assignmentKey || "").trim();
    if (!key) continue;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(reminder);
  }
  for (const list of grouped.values()) {
    list.sort((a, b) => String(a.remindAtUtc || "").localeCompare(String(b.remindAtUtc || "")));
  }
  return grouped;
}

function assignmentQuickActions() {
  return ["submitted", "waiting_on_teacher", "excused", "needs_follow_up", "add_note", "more"];
}

function taskQuickActions(task) {
  if (task.status === "done") return ["reopen", "edit_follow_up", "delete_follow_up"];
  return ["mark_done", "edit_follow_up", "delete_follow_up"];
}

function mapAssignmentRow(row, notesByKey, reminderGroups, timeZone, nowDate) {
  const notesPreview = mapNotesPreview(notesByKey.get(row.key) || []);
  const reminders = reminderGroups.get(row.key) || [];
  const nextReminder = reminders[0] || null;
  const dueFields = mapDueDate(row.dueDate, timeZone);
  const inferredSubmittedUngraded = row.isMissing === true && isSubmittedUngraded(row);
  const bucket = displayBucket(row.statusCategory, { inferredSubmittedUngraded });
  const todayYmd = formatDateYmd(nowDate, timeZone);
  const title = deriveSchoologyAssignmentTitle({ title: row.title || "", rawText: row.rawText || "" });
  return {
    kind: "assignment",
    key: row.key,
    assignmentId: row.assignmentId || null,
    course: row.course || "",
    title,
    schoologyStatus: row.status || "",
    effectiveStatus: row.effectiveStatus || row.status || "",
    manualStatus: row.manualStatus || "",
    statusCategory: row.statusCategory || "actionable",
    displayCategory: bucket.id,
    bucketLabel: bucket.label,
    homeBucketLabel: bucket.homeLabel,
    displayStatusLabel: displayStatusLabel(row, inferredSubmittedUngraded),
    score: row.score || "",
    url: row.url || "",
    notesCount: Number(row.notesCount || 0),
    notesPreview,
    hasNotes: Number(row.notesCount || 0) > 0,
    pendingReminderCount: reminders.length,
    hasReminder: reminders.length > 0,
    nextReminder,
    firstSeenAt: row.firstSeenAt || null,
    lastSeenAt: row.lastSeenAt || null,
    lastMissingAt: row.lastMissingAt || null,
    resolvedAt: row.resolvedAt || null,
    isMissing: row.isMissing === true,
    autoIgnored: row.autoIgnored === true,
    autoIgnoreReason: row.autoIgnoreReason || "",
    inferredSubmittedUngraded,
    reasonText: bucketReasonText({ ...row, ...dueFields }, inferredSubmittedUngraded, todayYmd),
    previewNote: notesPreview[0]?.note || "",
    quickActions: assignmentQuickActions(),
    ...dueFields,
  };
}

function filterAssignmentRows(rows, { includePending, includeIgnored }) {
  return rows.filter((row) => {
    if (!includePending && row.displayCategory === "pending") return false;
    if (!includeIgnored && row.displayCategory === "ignored") return false;
    return true;
  });
}

function buildAssignmentSummary(rows) {
  const summary = {
    total: rows.length,
    actionable: 0,
    waiting: 0,
    handled: 0,
    withReminders: 0,
    withNotes: 0,
  };
  for (const row of rows) {
    if (row.displayCategory === "pending") summary.waiting += 1;
    else if (row.displayCategory === "ignored") summary.handled += 1;
    else summary.actionable += 1;
    if (row.hasReminder) summary.withReminders += 1;
    if (row.hasNotes) summary.withNotes += 1;
  }
  return summary;
}

function mapTaskRow(task, timeZone, nowDate) {
  const mapped = addLocalReminderFields(task, timeZone);
  const remindAtDate = mapped.remindAtUtc ? new Date(mapped.remindAtUtc) : null;
  const isPending = mapped.status === "pending";
  const today = formatDateYmd(nowDate, timeZone);
  const remindAtYmd =
    remindAtDate && Number.isFinite(remindAtDate.getTime()) ? formatDateYmd(remindAtDate, timeZone) : null;
  const isOverdue = Boolean(isPending && remindAtDate && remindAtDate < nowDate && remindAtYmd < today);
  const isToday = Boolean(isPending && remindAtYmd === today);
  const isUpcoming = Boolean(isPending && remindAtYmd && remindAtYmd > today);
  const statusLabel = mapped.status === "done" ? "Completed" : isOverdue ? "Overdue" : isToday ? "Today" : "Coming up";
  return {
    ...mapped,
    kind: "task",
    displayCategory: mapped.status === "done" ? "ignored" : isOverdue ? "actionable" : "pending",
    bucketLabel: mapped.status === "done" ? "Handled for now" : "Follow-up",
    homeBucketLabel: mapped.status === "done" ? "Handled for Now" : isToday || isOverdue ? "Needs Attention Tonight" : "Coming Up",
    displayStatusLabel: statusLabel,
    reasonText:
      mapped.status === "done"
        ? "Completed follow-up."
        : isOverdue
        ? "This follow-up is overdue."
        : isToday
        ? "This follow-up is set for today."
        : `Follow-up scheduled for ${mapped.remindAtLabel || mapped.remindAtLocal || "later"}.`,
    previewNote: mapped.message || "",
    quickActions: taskQuickActions(mapped),
    isOverdue,
    isToday,
    isUpcoming,
    remindAtYmd,
  };
}

function buildTaskSummary(rows) {
  const summary = {
    total: rows.length,
    pending: 0,
    done: 0,
    overdue: 0,
    today: 0,
    upcoming: 0,
  };
  for (const row of rows) {
    if (row.status === "done") {
      summary.done += 1;
      continue;
    }
    summary.pending += 1;
    if (row.isOverdue) summary.overdue += 1;
    else if (row.isToday) summary.today += 1;
    else if (row.isUpcoming) summary.upcoming += 1;
  }
  return summary;
}

function loadAssignmentRecord(db, key) {
  return db
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
      WHERE key = ?
    `
    )
    .get(key);
}

function loadAssignmentRows({ db, status, timeZone, nowDate }) {
  const sourceRows = listAssignments(db, {
    status,
    includePending: true,
    includeIgnored: true,
    limit: WORKBENCH_LIMIT,
  });
  const keys = sourceRows.map((row) => row.key).filter(Boolean);
  const notesByKey = listAssignmentNotes(db, {
    keys,
    limitPerAssignment: NOTES_PREVIEW_LIMIT,
  });
  const reminderGroups = groupRemindersByAssignment(listReminders(db, { status: "pending" }), timeZone);
  return sourceRows.map((row) => mapAssignmentRow(row, notesByKey, reminderGroups, timeZone, nowDate));
}

function loadPersonalTasks({ db, timeZone, nowDate, status = "all" }) {
  return listTasks(db, { status })
    .filter((task) => !task.assignmentKey && task.kind !== "assignment")
    .map((task) => mapTaskRow(task, timeZone, nowDate));
}

function earliestPendingReminder(db, timeZone) {
  const pendingTasks = addLocalReminderFieldsToList(listTasks(db, { status: "pending" }), timeZone).sort((a, b) =>
    String(a.remindAtUtc || "").localeCompare(String(b.remindAtUtc || ""))
  );
  return pendingTasks[0] || null;
}

function toHomeSectionKey(item, todayYmd) {
  if (item.kind === "task") {
    if (item.status === "done") return "handled";
    if (item.isOverdue || item.isToday) return "tonight";
    return "comingUp";
  }
  if (item.displayCategory === "pending") return "waiting";
  if (item.displayCategory === "ignored") return "handled";
  if (!item.dueDateYmd || item.dueDateYmd <= todayYmd) return "tonight";
  return "comingUp";
}

function sortHomeItems(items) {
  return [...items].sort((a, b) => {
    const dateA = a.kind === "task" ? a.remindAtUtc || a.remindAt || "" : a.dueDateIso || a.dueDateSort || "";
    const dateB = b.kind === "task" ? b.remindAtUtc || b.remindAt || "" : b.dueDateIso || b.dueDateSort || "";
    if (dateA !== dateB) return String(dateA).localeCompare(String(dateB));
    return String(a.title || "").localeCompare(String(b.title || ""));
  });
}

function homeSectionsPayload(sections) {
  return {
    tonight: {
      id: "tonight",
      label: "Needs Attention Tonight",
      emptyLabel: "Nothing urgent is sitting in tonight's pile.",
      rows: sortHomeItems(sections.tonight),
    },
    comingUp: {
      id: "comingUp",
      label: "Coming Up",
      emptyLabel: "No future follow-ups are queued right now.",
      rows: sortHomeItems(sections.comingUp),
    },
    waiting: {
      id: "waiting",
      label: "Waiting on School",
      emptyLabel: "Nothing is currently waiting on a grade or teacher follow-up.",
      rows: sortHomeItems(sections.waiting),
    },
    handled: {
      id: "handled",
      label: "Handled for Now",
      emptyLabel: "Nothing has been filed away yet.",
      rows: sortHomeItems(sections.handled),
    },
  };
}

export function buildDashboardMeta({ config }) {
  const timeZone = config?.schedule?.timezone || "America/New_York";
  return {
    generatedAt: new Date().toISOString(),
    timezone: timeZone,
    primaryViews: [
      { id: "home", label: "Home", default: true },
      { id: "schoolwork", label: "All Schoolwork", default: false },
    ],
    utilityViews: [{ id: "admin", label: "Admin", default: false }],
    assignmentStatusFilters: [
      { value: "missing", label: "Needs review" },
      { value: "resolved", label: "Resolved" },
      { value: "all", label: "All assignments" },
    ],
    taskStatusFilters: [
      { value: "pending", label: "Pending" },
      { value: "done", label: "Completed" },
      { value: "all", label: "All follow-ups" },
    ],
    bucketLabels: Object.values(PARENT_BUCKETS),
    quickActions: Object.values(DASHBOARD_QUICK_ACTIONS),
    manualStatuses: [
      { value: "", label: "Clear status", category: "actionable", code: "" },
      ...Object.entries(STATUS_CODE_MAP).map(([code, label]) => ({
        value: label,
        label: MANUAL_STATUS_UI[label]?.label || label,
        rawLabel: label,
        description: MANUAL_STATUS_UI[label]?.description || PARENT_BUCKETS.actionable.label,
        category: getManualStatusCategory(label),
        code,
      })),
    ],
    recurrences: recurrenceOptionList(),
    tools: DASHBOARD_ALLOWED_TOOL_NAMES.map((name) => ({ name })),
  };
}

export function buildHomeWorkspace({
  config,
  dbOverride = null,
  now = new Date(),
} = {}) {
  const db = getDashboardDb(config, dbOverride);
  const timeZone = config?.schedule?.timezone || "America/New_York";
  const nowDate = now instanceof Date ? now : new Date(now);
  const todayYmd = formatDateYmd(nowDate, timeZone);
  const assignments = loadAssignmentRows({
    db,
    status: "missing",
    timeZone,
    nowDate,
  });
  const personalTasks = loadPersonalTasks({
    db,
    timeZone,
    nowDate,
    status: "all",
  });
  const sections = { tonight: [], comingUp: [], waiting: [], handled: [] };

  for (const item of [...assignments, ...personalTasks]) {
    sections[toHomeSectionKey(item, todayYmd)].push(item);
  }

  const nextReminder = earliestPendingReminder(db, timeZone);
  const payloadSections = homeSectionsPayload(sections);

  return {
    generatedAt: new Date().toISOString(),
    timezone: timeZone,
    summary: {
      tonightCount: payloadSections.tonight.rows.length,
      comingUpCount: payloadSections.comingUp.rows.length,
      waitingCount: payloadSections.waiting.rows.length,
      handledCount: payloadSections.handled.rows.length,
      nextReminder,
    },
    sections: payloadSections,
  };
}

export function buildAssignmentsWorkspace({
  config,
  query = {},
  dbOverride = null,
  now = new Date(),
} = {}) {
  const db = getDashboardDb(config, dbOverride);
  const timeZone = config?.schedule?.timezone || "America/New_York";
  const status = normalizeStatusFilter(query.status);
  const includePending = normalizeBoolean(query.includePending, true);
  const includeIgnored = normalizeBoolean(query.includeIgnored, true);
  const rows = loadAssignmentRows({
    db,
    status,
    timeZone,
    nowDate: now instanceof Date ? now : new Date(now),
  });
  const visibleRows = filterAssignmentRows(rows, { includePending, includeIgnored });
  return {
    generatedAt: new Date().toISOString(),
    timezone: timeZone,
    filters: {
      status,
      includePending,
      includeIgnored,
    },
    summary: buildAssignmentSummary(rows),
    visibleCount: visibleRows.length,
    rows: visibleRows,
  };
}

export function buildAssignmentDetail({
  config,
  key,
  dbOverride = null,
  now = new Date(),
} = {}) {
  const db = getDashboardDb(config, dbOverride);
  const timeZone = config?.schedule?.timezone || "America/New_York";
  const assignment = loadAssignmentRecord(db, key);
  if (!assignment) return null;
  const notesByKey = listAssignmentNotes(db, {
    keys: [key],
    limitPerAssignment: WORKBENCH_LIMIT,
  });
  const notes = mapNotesPreview(notesByKey.get(key) || []);
  const reminderList = addLocalReminderFieldsToList(listReminders(db, { key, status: "all" }), timeZone);
  const pendingReminders = reminderList.filter((entry) => entry.status === "pending");
  const inferredSubmittedUngraded = assignment.isMissing === 1 && isSubmittedUngraded(assignment);
  const statusCategory =
    assignment.autoIgnored === 1
      ? "ignored"
      : inferredSubmittedUngraded
      ? "ignored"
      : getManualStatusCategory(assignment.manualStatus || "");
  return {
    generatedAt: new Date().toISOString(),
    timezone: timeZone,
    assignment: mapAssignmentRow(
      {
        ...assignment,
        autoIgnored: assignment.autoIgnored === 1,
        isMissing: assignment.isMissing === 1,
        effectiveStatus: assignment.manualStatus || assignment.status || "",
        statusCategory,
      },
      new Map([[key, notes]]),
      new Map([[key, pendingReminders]]),
      timeZone,
      now instanceof Date ? now : new Date(now)
    ),
    notes,
    reminders: reminderList,
    pendingReminder: pendingReminders[0] || null,
  };
}

export function buildTasksWorkspace({
  config,
  query = {},
  dbOverride = null,
  now = new Date(),
} = {}) {
  const db = getDashboardDb(config, dbOverride);
  const timeZone = config?.schedule?.timezone || "America/New_York";
  const status = normalizeTaskStatusFilter(query.status);
  const allTasks = loadPersonalTasks({
    db,
    timeZone,
    nowDate: now instanceof Date ? now : new Date(now),
    status: "all",
  });
  const rows = allTasks.filter((task) => {
    if (status === "all") return true;
    return task.status === status;
  });
  return {
    generatedAt: new Date().toISOString(),
    timezone: timeZone,
    filters: { status },
    summary: buildTaskSummary(allTasks),
    visibleCount: rows.length,
    rows,
  };
}
