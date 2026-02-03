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
import { nowIso } from "./time.js";
import { getDb, syncAssignmentsFromState } from "./db.js";
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

  const summary = buildSummary(state, state.lastSummarySentAt);
  for (const channel of channels) {
    if (channel === "twilio") {
      await sendSummarySms(config, summary, state);
    } else if (channel === "telegram") {
      await sendSummaryTelegram(config, summary, state);
    } else if (channel === "email") {
      await sendSummaryEmail(config, summary, state);
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
