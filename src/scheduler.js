import cron from "node-cron";
import { getConfig } from "./config.js";
import { runScrape, runSend } from "./tasks.js";

const config = getConfig();

console.log(`Scheduler started. Scrape: ${config.schedule.scrapeCron}. Send: ${config.schedule.sendCron}. TZ: ${config.schedule.timezone}`);

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

process.stdin.resume();
