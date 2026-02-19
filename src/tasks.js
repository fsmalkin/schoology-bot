import {
  getConfig,
  resolveDeliveryChannels,
  validateCredentials,
  validateEmailConfig,
  validateTelegramConfig,
  validateTwilioConfig,
} from "./config.js";
import { scrapeMissingAssignments } from "./schoology.js";
import { loadState, saveState, updateStateWithScrape } from "./storage.js";
import {
  formatDateYmd,
  formatDateTime,
  nowIso,
  parseSchoologyDate,
  getLocalDateParts,
  makeDateInZoneParts,
} from "./time.js";
import {
  applyAutoIgnoreRules,
  cancelInactiveAssignmentTasks,
  createAssignmentTask,
  createTask,
  deleteTask,
  findPendingAssignmentTask,
  getDb,
  listDueTasks,
  listAssignments,
  listTasks,
  markTaskReminderSent,
  syncAssignmentsFromState,
  updateTask,
  updateTaskStatus,
} from "./db.js";
import { buildDbSummary } from "./summary.js";
import { buildOptionalSummaryNotes } from "./summary_agent.js";
import { buildReadableDailySummary, buildReadableReminderMessage } from "./readable_messages.js";
import { sendSummaryEmail } from "./email.js";
import { sendSummarySms } from "./sms.js";
import { sendSummaryTelegram, sendTelegramMessage } from "./telegram.js";

function isLoginFailure(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return (
    message.includes("login failed") ||
    message.includes("login flow not recognized") ||
    message.includes("login required")
  );
}

async function maybeSendLoginAlert(config, error) {
  if (!isLoginFailure(error)) return;
  if (!config.telegram.botToken || !config.telegram.chatIds || config.telegram.chatIds.length === 0) return;

  const text =
    "Schoology login failed or expired. Run `npm run login:interactive` to refresh the session (or update STORAGE_STATE_* secrets), then retry.";

  try {
    await sendTelegramMessage(config, text);
  } catch (sendError) {
    console.error("Failed to send Telegram alert:", sendError?.message || sendError);
  }
}

export async function runScrape() {
  const config = getConfig();
  validateCredentials();

  const state = loadState(config.paths.statePath);
  const scrapeAt = nowIso();

  let assignments;
  try {
    assignments = await scrapeMissingAssignments(config);
  } catch (error) {
    await maybeSendLoginAlert(config, error);
    throw error;
  }
  updateStateWithScrape(state, scrapeAt, assignments);
  saveState(config.paths.statePath, state);
  const db = getDb(config);
  syncAssignmentsFromState(db, state);
  if (config.autoIgnore.enabled) {
    applyAutoIgnoreRules(db, {
      now: scrapeAt,
      oldDays: config.autoIgnore.oldDays,
      keywords: config.autoIgnore.keywords,
    });
  }
  let autoCanceledAssignmentReminders = { ok: true, canceled: 0, byReason: {} };
  if (config.reminders?.autoCancelResolvedAssignmentReminders !== false) {
    autoCanceledAssignmentReminders = cancelInactiveAssignmentTasks(db, { now: scrapeAt });
    if (autoCanceledAssignmentReminders.canceled > 0) {
      console.log(
        `Auto-canceled ${autoCanceledAssignmentReminders.canceled} assignment reminder(s): ${JSON.stringify(
          autoCanceledAssignmentReminders.byReason
        )}`
      );
    }
  }
  if (config.autoUpcoming.enabled) {
    autoPlanUpcomingReminders(db, config);
  }

  const missingCount = assignments.filter((item) => item.isMissing).length;
  console.log(`Scrape complete. Missing assignments found: ${missingCount}`);
  return { state, assignments, autoCanceledAssignmentReminders };
}

export async function buildDailySummaryText(options = {}) {
  const config = options.config || getConfig();
  const db = options.dbOverride || getDb(config);
  const includeOptionalNotes = options.includeOptionalNotes !== false;
  const allowScrapeFallback = options.allowScrapeFallback !== false;
  const now = options.now || new Date();

  let state = options.stateOverride || loadState(config.paths.statePath);
  if (!options.stateOverride && allowScrapeFallback && !state.lastScrapeAt) {
    await runScrape();
    state = loadState(config.paths.statePath);
  }

  const dbSummary = buildDbSummary(db, { includePending: true, includeIgnored: false, includeNotes: true });
  const today = formatDateYmd(now, config.schedule.timezone);
  const allPendingTasks = listTasks(db, { status: "pending" });
  const reminders = groupReminders(allPendingTasks, config.schedule.timezone, today);
  const coreSummaryText = buildReadableDailySummary({
    summary: dbSummary,
    reminders,
    state,
    timeZone: config.schedule.timezone,
    now,
  });

  let optionalNotes = "";
  if (includeOptionalNotes) {
    optionalNotes =
      (await buildOptionalSummaryNotes({
        config,
        summary: dbSummary,
        state,
        reminders,
      })) || "";
  }
  const summaryText = optionalNotes ? `${coreSummaryText}\n\n${optionalNotes}` : coreSummaryText;

  return { state, summary: dbSummary, reminders, summaryText, optionalNotes };
}

export async function runSend(options = {}) {
  const config = options.config || getConfig();
  const senders = options.senders || {};
  const skipValidate = options.skipValidate === true;
  const channels = resolveDeliveryChannels(config);
  if (channels.includes("email")) {
    if (!skipValidate) validateEmailConfig();
  }
  if (channels.includes("twilio")) {
    if (!skipValidate) validateTwilioConfig();
  }
  if (channels.includes("telegram")) {
    if (!skipValidate) validateTelegramConfig();
  }
  const { state, summary: dbSummary, summaryText } = await buildDailySummaryText({
    config,
    includeOptionalNotes: true,
    allowScrapeFallback: true,
  });

  for (const channel of channels) {
    if (channel === "twilio") {
      const sendSms = senders.sms || sendSummarySms;
      await sendSms(config, summaryText);
    } else if (channel === "telegram") {
      const sendTelegram = senders.telegram || sendSummaryTelegram;
      await sendTelegram(config, summaryText);
    } else if (channel === "email") {
      const sendEmail = senders.email || sendSummaryEmail;
      await sendEmail(config, summaryText);
    }
  }

  state.lastSummarySentAt = nowIso();
  saveState(config.paths.statePath, state);

  console.log("Summary sent.");
  return { state, summary: dbSummary };
}

export async function runLiveCheck(options = {}) {
  const config = options.config || getConfig();
  const senders = options.senders || {};
  const skipValidate = options.skipValidate === true;

  if (!skipValidate) {
    validateTelegramConfig();
  }

  const chatIds =
    config.liveChecks && config.liveChecks.chatIds && config.liveChecks.chatIds.length > 0
      ? config.liveChecks.chatIds
      : config.telegram.chatIds;

  if (!chatIds || chatIds.length === 0) {
    return { ok: false, error: "No Telegram chat IDs configured for live checks." };
  }

  const timestamp = formatDateTime(new Date(), config.schedule.timezone);
  const text = `Live check ok (${timestamp}).`;
  const sendRaw = senders.telegramRaw || sendTelegramMessage;
  const liveConfig = { ...config, telegram: { ...config.telegram, chatIds } };
  await sendRaw(liveConfig, text);
  return { ok: true, sentTo: chatIds.length };
}

export async function runOnce() {
  await runScrape();
  await runSend();
}

function addDays(date, days) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function shiftYmd(parts, days) {
  const base = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  base.setUTCDate(base.getUTCDate() + days);
  return {
    year: base.getUTCFullYear(),
    month: base.getUTCMonth() + 1,
    day: base.getUTCDate(),
  };
}

function buildUpcomingSet(baseDate, timeZone, days = 7) {
  const set = new Set();
  for (let i = 1; i <= days; i += 1) {
    const next = addDays(baseDate, i);
    set.add(formatDateYmd(next, timeZone));
  }
  return set;
}

function groupReminders(tasks, timeZone, today) {
  const baseDate = new Date();
  const upcomingSet = buildUpcomingSet(baseDate, timeZone, 7);
  const groups = { today: [], overdue: [], upcoming: [] };
  for (const task of tasks) {
    if (!task.remindAt) continue;
    const taskDate = formatDateYmd(new Date(task.remindAt), timeZone);
    if (taskDate < today) {
      groups.overdue.push(task);
    } else if (taskDate === today) {
      groups.today.push(task);
    } else if (upcomingSet.has(taskDate)) {
      groups.upcoming.push(task);
    }
  }
  return groups;
}

export function autoPlanUpcomingReminders(db, config, nowOverride) {
  const upcomingDays = Math.max(1, Number(config.autoUpcoming.days || 7));
  const now = nowOverride ? new Date(nowOverride) : new Date();
  const windowEnd = addDays(now, upcomingDays);
  const assignments = listAssignments(db, { status: "all", includeIgnored: true, includePending: true, limit: 500 });

  let created = 0;
  for (const assignment of assignments) {
    if (assignment.isMissing) continue;
    if (!assignment.dueDate) continue;
    if (assignment.manualStatus) continue;
    if (assignment.autoIgnored) continue;

    const due = parseSchoologyDate(assignment.dueDate, config.schedule.timezone);
    if (!due) continue;
    if (due < now || due > windowEnd) continue;

    const remindAt = buildAutoReminderTime(due, config);
    if (!remindAt || remindAt < now) continue;

    const existing = findPendingAssignmentTask(db, { key: assignment.key });
    if (existing) continue;

    const title = `${assignment.course} - ${assignment.title}`;
    const message = `Auto reminder for upcoming due date (${assignment.dueDate}).`;
    const result = createAssignmentTask(db, {
      key: assignment.key,
      title,
      remindAt: remindAt.toISOString(),
      message,
      autoPlanned: true,
    });
    if (result.ok) created += 1;
  }
  if (created > 0) {
    console.log(`Auto-planned ${created} upcoming reminder(s).`);
  }
}

export function rescheduleAutoPlannedReminders(db, config, nowOverride) {
  const now = nowOverride ? new Date(nowOverride) : new Date();
  const tz = config.schedule.timezone;
  const remindHour = Number(config.autoUpcoming.remindHour ?? 19);
  const remindMinute = Number(config.autoUpcoming.remindMinute ?? 0);
  const rows = db
    .prepare(
      `
      SELECT id, assignment_key AS assignmentKey, remind_at AS remindAt
      FROM tasks
      WHERE status = 'pending' AND kind = 'assignment' AND auto_planned = 1
    `
    )
    .all();

  const lookupAssignment = db.prepare(
    "SELECT due_date AS dueDate FROM assignments WHERE key = ?"
  );

  let updated = 0;
  for (const row of rows) {
    const assignment = lookupAssignment.get(row.assignmentKey);
    if (!assignment || !assignment.dueDate) continue;
    const due = parseSchoologyDate(assignment.dueDate, tz);
    if (!due || due < now) continue;
    let next = buildAutoReminderTime(due, config);
    if (!next || next < now) {
      const dueParts = getLocalDateParts(due, tz);
      if (dueParts) {
        const sameDay = makeDateInZoneParts(
          { ...dueParts, hour: remindHour, minute: remindMinute },
          tz
        );
        if (sameDay >= now && sameDay <= due) {
          next = sameDay;
        }
      }
    }
    if (!next || next < now) continue;
    const nextIso = next.toISOString();
    if (nextIso === row.remindAt) continue;
    updateTask(db, { id: row.id, remindAt: nextIso });
    updated += 1;
  }

  return { ok: true, checked: rows.length, updated };
}

function buildAutoReminderTime(dueDate, config) {
  const tz = config.schedule.timezone;
  const remindHour = Number(config.autoUpcoming.remindHour ?? 19);
  const remindMinute = Number(config.autoUpcoming.remindMinute ?? 0);
  const dueParts = getLocalDateParts(dueDate, tz);
  if (!dueParts) return null;
  let remindParts = shiftYmd(dueParts, -1);
  let remindDate = makeDateInZoneParts(
    { ...remindParts, hour: remindHour, minute: remindMinute },
    tz
  );
  if (remindDate > dueDate) {
    remindParts = shiftYmd(dueParts, -2);
    remindDate = makeDateInZoneParts(
      { ...remindParts, hour: remindHour, minute: remindMinute },
      tz
    );
  }
  return remindDate;
}

export async function runReminders(options = {}) {
  const config = options.config || getConfig();
  const senders = options.senders || {};
  const nowOverride = options.nowOverride;
  const sendRaw = senders.telegramRaw || senders.telegram || sendTelegramMessage;
  const hasCustomSender = Boolean(senders.telegramRaw || senders.telegram);
  if (
    !hasCustomSender &&
    (!config.telegram.botToken || !config.telegram.chatIds || config.telegram.chatIds.length === 0)
  ) {
    return { ok: false, skipped: true, reason: "telegram_not_configured" };
  }

  const db = options.dbOverride || getDb(config);
  const now = nowOverride || nowIso();
  let autoCanceledAssignmentReminders = { ok: true, canceled: 0, byReason: {} };
  if (config.reminders?.autoCancelResolvedAssignmentReminders !== false) {
    autoCanceledAssignmentReminders = cancelInactiveAssignmentTasks(db, { now });
    if (autoCanceledAssignmentReminders.canceled > 0) {
      console.log(
        `Auto-canceled ${autoCanceledAssignmentReminders.canceled} due-reminder task(s) before dispatch: ${JSON.stringify(
          autoCanceledAssignmentReminders.byReason
        )}`
      );
    }
  }
  const due = listDueTasks(db, now);
  if (due.length === 0) {
    return { ok: true, sent: 0, messages: [], autoCanceledAssignmentReminders };
  }

  const messages = [];
  for (const task of due) {
    const remindAt = task.remindAt ? new Date(task.remindAt) : new Date();
    const text = buildReadableReminderMessage({
      task,
      timeZone: config.schedule.timezone,
      now: new Date(now),
    });
    try {
      await sendRaw(config, text);
      messages.push(text);
      const next = addDays(remindAt, 1).toISOString();
      markTaskReminderSent(db, { id: task.id, sentAt: now, nextRemindAt: next });
    } catch (err) {
      console.error("Failed to send reminder:", err?.message || err);
    }
  }
  return { ok: true, sent: messages.length, messages, autoCanceledAssignmentReminders };
}

export const taskApi = {
  createTask,
  listTasks,
  updateTaskStatus,
  updateTask,
  deleteTask,
};
