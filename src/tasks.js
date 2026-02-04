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
import { formatDateYmd, formatDateTime, nowIso } from "./time.js";
import {
  createTask,
  deleteTask,
  getDb,
  listDueTasks,
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

  console.log(`Scrape complete. Missing assignments found: ${assignments.length}`);
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
  const dbSummary = buildDbSummary(db, { includePending: true, includeIgnored: false });
  const legacySummary = buildLegacySummary(dbSummary);
  const today = formatDateYmd(new Date(), config.schedule.timezone);
  const tasksForToday = listTasks(db, { status: "all" }).filter((task) => {
    if (!task.remindAt) return false;
    return formatDateYmd(new Date(task.remindAt), config.schedule.timezone) === today;
  });
  for (const channel of channels) {
    if (channel === "twilio") {
      await sendSummarySms(config, legacySummary, state, tasksForToday);
    } else if (channel === "telegram") {
      if (config.openai.apiKey) {
        const text = await buildAgenticTelegramSummary({
          config,
          summary: dbSummary,
          state,
          tasksForToday,
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
