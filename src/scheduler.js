import cron from "node-cron";
import { getConfig } from "./config.js";
import { runLiveCheck, runReminders, runScrape, runSend } from "./tasks.js";

const config = getConfig();

console.log(
  `Scheduler started. Scrape: ${config.schedule.scrapeCron}. Send: ${config.schedule.sendCron}. Reminders: ${config.schedule.reminderCron}. TZ: ${config.schedule.timezone}`
);

if (config.liveChecks.enabled) {
  console.log(`Live checks enabled. Cron: ${config.liveChecks.cron}.`);
}

cron.schedule(
  config.schedule.scrapeCron,
  () => {
    runScrape().catch((err) => console.error(err.message || err));
  },
  { timezone: config.schedule.timezone }
);

cron.schedule(
  config.schedule.sendCron,
  () => {
    runSend().catch((err) => console.error(err.message || err));
  },
  { timezone: config.schedule.timezone }
);

cron.schedule(
  config.schedule.reminderCron,
  () => {
    runReminders().catch((err) => console.error(err.message || err));
  },
  { timezone: config.schedule.timezone }
);

if (config.liveChecks.enabled) {
  cron.schedule(
    config.liveChecks.cron,
    () => {
      runLiveCheck().catch((err) => console.error(err.message || err));
    },
    { timezone: config.schedule.timezone }
  );
}

process.stdin.resume();
