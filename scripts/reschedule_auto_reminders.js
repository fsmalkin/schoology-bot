import "dotenv/config";
import { getConfig } from "../src/config.js";
import { getDb } from "../src/db.js";
import { rescheduleAutoPlannedReminders } from "../src/tasks.js";

const config = getConfig();
const db = getDb(config);
const result = rescheduleAutoPlannedReminders(db, config);

if (!result.ok) {
  console.error("Reschedule failed.");
  process.exit(1);
}

console.log(
  `Rescheduled ${result.updated} of ${result.checked} auto-planned reminder(s).`
);
