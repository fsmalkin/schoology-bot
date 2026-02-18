import cron from "node-cron";
import { getConfig } from "./config.js";
import { runLiveCheck, runReminders, runScrape, runSend } from "./tasks.js";
import { writeServiceHeartbeat } from "./health.js";

const config = getConfig();
const runtime = {
  startedAt: new Date().toISOString(),
  lastScrapeAt: null,
  lastSendAt: null,
  lastReminderAt: null,
  lastLiveCheckAt: null,
  lastError: null,
};

function updateHeartbeat(extra = {}) {
  try {
    writeServiceHeartbeat(config, "scheduler", {
      status: "running",
      timezone: config.schedule.timezone,
      scrapeCron: config.schedule.scrapeCron,
      sendCron: config.schedule.sendCron,
      reminderCron: config.schedule.reminderCron,
      liveCheckEnabled: config.liveChecks.enabled === true,
      ...runtime,
      ...extra,
    });
  } catch (err) {
    // heartbeat failures should not stop scheduler jobs
  }
}

function runWithHeartbeat(key, runner) {
  runner()
    .then(() => {
      runtime[key] = new Date().toISOString();
      runtime.lastError = null;
      updateHeartbeat();
    })
    .catch((err) => {
      runtime.lastError = err?.message || String(err);
      updateHeartbeat();
      console.error(err.message || err);
    });
}

console.log(
  `Scheduler started. Scrape: ${config.schedule.scrapeCron}. Send: ${config.schedule.sendCron}. Reminders: ${config.schedule.reminderCron}. TZ: ${config.schedule.timezone}`
);

if (config.liveChecks.enabled) {
  console.log(`Live checks enabled. Cron: ${config.liveChecks.cron}.`);
}
updateHeartbeat();
setInterval(() => updateHeartbeat(), 30000);

cron.schedule(
  config.schedule.scrapeCron,
  () => {
    runWithHeartbeat("lastScrapeAt", runScrape);
  },
  { timezone: config.schedule.timezone }
);

cron.schedule(
  config.schedule.sendCron,
  () => {
    runWithHeartbeat("lastSendAt", runSend);
  },
  { timezone: config.schedule.timezone }
);

cron.schedule(
  config.schedule.reminderCron,
  () => {
    runWithHeartbeat("lastReminderAt", runReminders);
  },
  { timezone: config.schedule.timezone }
);

if (config.liveChecks.enabled) {
  cron.schedule(
    config.liveChecks.cron,
    () => {
      runWithHeartbeat("lastLiveCheckAt", runLiveCheck);
    },
    { timezone: config.schedule.timezone }
  );
}

process.stdin.resume();
