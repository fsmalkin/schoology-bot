import {
  getConfig,
  resolveDeliveryChannels,
  validateCredentials,
  validateEmailConfig,
  validateTelegramConfig,
  validateTwilioConfig,
} from "./config.js";
import { scrapeMissingAssignments } from "./schoology.js";
import { buildSummary, loadState, saveState, updateStateWithScrape } from "./storage.js";
import { formatDateYmd, formatDateTime, nowIso, parseSchoologyDate } from "./time.js";
import {
  applyAutoIgnoreRules,
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
import { buildDbSummary, buildLegacySummary } from "./summary.js";
import { buildAgenticTelegramSummary } from "./summary_agent.js";
import { sendSummaryEmail } from "./email.js";
import { sendSummarySms } from "./sms.js";
import { sendSummaryTelegram, sendTelegramMessage } from "./telegram.js";
import { renderTelegramHtml } from "./telegram_format.js";

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
    "Schoology login failed or expired. Run `npm run login:interactive` to refresh the session, then retry.";

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
  if (config.autoUpcoming.enabled) {
    autoPlanUpcomingReminders(db, config);
  }

  const missingCount = assignments.filter((item) => item.isMissing).length;
  console.log(`Scrape complete. Missing assignments found: ${missingCount}`);
  return { state, assignments };
}

export async function runSend() {
  const config = getConfig();
  const channels = resolveDeliveryChannels(config);
  if (channels.includes("email")) {
    validateEmailConfig();
  }
  if (channels.includes("twilio")) {
    validateTwilioConfig();
  }
  if (channels.includes("telegram")) {
    validateTelegramConfig();
  }

  let state = loadState(config.paths.statePath);
  if (!state.lastScrapeAt) {
    await runScrape();
    state = loadState(config.paths.statePath);
  }

  const db = getDb(config);
  const dbSummary = buildDbSummary(db, { includePending: true, includeIgnored: false, includeNotes: true });
  const legacySummary = buildLegacySummary(dbSummary);
  const today = formatDateYmd(new Date(), config.schedule.timezone);
  const allPendingTasks = listTasks(db, { status: "pending" });
  const reminders = groupReminders(allPendingTasks, config.schedule.timezone, today);
  const tasksForToday = reminders.today;
  for (const channel of channels) {
    if (channel === "twilio") {
      await sendSummarySms(config, legacySummary, state, tasksForToday);
    } else if (channel === "telegram") {
      if (config.openai.apiKey) {
        const text = await buildAgenticTelegramSummary({
          config,
          summary: dbSummary,
          state,
          reminders,
        });
        await sendTelegramMessage(config, text);
      } else {
        await sendSummaryTelegram(config, legacySummary, state, tasksForToday);
      }
    } else if (channel === "email") {
      await sendSummaryEmail(config, legacySummary, state, tasksForToday);
    }
  }

  state.lastSummarySentAt = nowIso();
  saveState(config.paths.statePath, state);

  console.log("Summary sent.");
  return { state, summary };
}

export async function runOnce() {
  await runScrape();
  await runSend();
}

function addDays(date, days) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
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
    });
    if (result.ok) created += 1;
  }
  if (created > 0) {
    console.log(`Auto-planned ${created} upcoming reminder(s).`);
  }
}

function buildAutoReminderTime(dueDate, config) {
  const remindHour = Number(config.autoUpcoming.remindHour ?? 19);
  const remindMinute = Number(config.autoUpcoming.remindMinute ?? 0);
  const remindDate = new Date(dueDate.getTime());
  remindDate.setDate(remindDate.getDate() - 1);
  remindDate.setHours(remindHour, remindMinute, 0, 0);
  if (remindDate > dueDate) {
    remindDate.setDate(remindDate.getDate() - 1);
  }
  return remindDate;
}

export async function runReminders() {
  const config = getConfig();
  if (!config.telegram.botToken || !config.telegram.chatIds || config.telegram.chatIds.length === 0) return;

  const db = getDb(config);
  const now = nowIso();
  const due = listDueTasks(db, now);
  if (due.length === 0) return;

  for (const task of due) {
    const remindAt = task.remindAt ? new Date(task.remindAt) : new Date();
    const prettyTime = formatDateTime(remindAt, config.schedule.timezone);
    const message = task.message ? `\n${task.message}` : "";
    const text = `Reminder: ${task.title} (scheduled ${prettyTime}).${message}`;
    const html = renderTelegramHtml(text);
    try {
      await sendTelegramMessage(config, html);
      const next = addDays(remindAt, 1).toISOString();
      markTaskReminderSent(db, { id: task.id, sentAt: now, nextRemindAt: next });
    } catch (err) {
      console.error("Failed to send reminder:", err?.message || err);
    }
  }
}

export const taskApi = {
  createTask,
  listTasks,
  updateTaskStatus,
  updateTask,
  deleteTask,
};
