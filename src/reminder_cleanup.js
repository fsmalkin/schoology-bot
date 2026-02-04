import "dotenv/config";
import { getConfig } from "./config.js";
import { dedupePendingReminders, getDb } from "./db.js";

const config = getConfig();
const db = getDb(config);
const result = dedupePendingReminders(db);
console.log(`Reminder cleanup removed ${result.removed} duplicate reminder(s).`);
