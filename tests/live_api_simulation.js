import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { nowIso, formatDateYmd } from "../src/time.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.join(__dirname, "..", "data");

function writeLog(lines) {
  const logPath = path.join(dataDir, "live_simulation.log");
  fs.writeFileSync(logPath, lines.join("\n"), "utf8");
  return logPath;
}

function seedState() {
  return {
    assignments: {
      a1: {
        key: "a1",
        course: "Algebra",
        title: "U5 Compound Interest/Intervals",
        dueDate: "2026-01-23",
        status: "Missing",
        score: "0/10",
        url: "https://example.com/a1",
        rawText: "",
        firstSeenAt: nowIso(),
        lastSeenAt: nowIso(),
        lastMissingAt: nowIso(),
        resolvedAt: null,
        isMissing: true,
      },
      a2: {
        key: "a2",
        course: "Latin",
        title: "January 30th-Tpc01C - Show What You Know",
        dueDate: "2026-02-14",
        status: "Missing",
        score: "0/10",
        url: "https://example.com/a2",
        rawText: "",
        firstSeenAt: nowIso(),
        lastSeenAt: nowIso(),
        lastMissingAt: nowIso(),
        resolvedAt: null,
        isMissing: true,
      },
      a3: {
        key: "a3",
        course: "Science",
        title: "Lab 1",
        dueDate: "2026-02-01",
        status: "Missing",
        score: "0/10",
        url: "https://example.com/a3",
        rawText: "",
        firstSeenAt: nowIso(),
        lastSeenAt: nowIso(),
        lastMissingAt: nowIso(),
        resolvedAt: null,
        isMissing: true,
      },
      a4: {
        key: "a4",
        course: "Science",
        title: "Lab 2",
        dueDate: "2026-02-02",
        status: "Missing",
        score: "0/10",
        url: "https://example.com/a4",
        rawText: "",
        firstSeenAt: nowIso(),
        lastSeenAt: nowIso(),
        lastMissingAt: nowIso(),
        resolvedAt: null,
        isMissing: true,
      },
    },
  };
}

function groupReminders(tasks, timeZone) {
  const today = formatDateYmd(new Date(), timeZone);
  const groups = { today: [], overdue: [], upcoming: [] };
  const upcomingDates = new Set();
  for (let i = 1; i <= 7; i += 1) {
    const next = new Date();
    next.setDate(next.getDate() + i);
    upcomingDates.add(formatDateYmd(next, timeZone));
  }
  for (const task of tasks) {
    if (!task.remindAt) continue;
    const taskDate = formatDateYmd(new Date(task.remindAt), timeZone);
    if (taskDate < today) groups.overdue.push(task);
    else if (taskDate === today) groups.today.push(task);
    else if (upcomingDates.has(taskDate)) groups.upcoming.push(task);
  }
  return groups;
}

async function runSimulation() {
  process.env.OPENAI_MAX_OUTPUT_TOKENS = process.env.OPENAI_MAX_OUTPUT_TOKENS || "500";
  process.env.OPENAI_REASONING_EFFORT = process.env.OPENAI_REASONING_EFFORT || "low";
  const dbPath = path.join(dataDir, `agent_sim_${Date.now()}.db`);
  process.env.AGENT_DB_PATH = dbPath;

  const {
    createDb,
    syncAssignmentsFromState,
    addAssignmentNote,
    createTask,
    listTasks,
    closeDb,
  } = await import("../src/db.js");
  const { runAgentMessage } = await import("../src/agent.js");
  const { getConfig } = await import("../src/config.js");
  const { buildDbSummary } = await import("../src/summary.js");
  const { buildAgenticTelegramSummary } = await import("../src/summary_agent.js");

  const db = createDb(dbPath);
  syncAssignmentsFromState(db, seedState());
  addAssignmentNote(db, { key: "a1", note: "Meet teacher for follow-up." });

  const timeZone = getConfig().schedule.timezone;
  const today = formatDateYmd(new Date(), timeZone);
  createTask(db, { title: "Ask teacher about Lab 1", remindAt: `${today}T18:00:00-05:00` });
  createTask(db, { title: "Prepare supplies", remindAt: `${today}T20:00:00-05:00` });

  const transcript = [];
  const chatId = `live-sim-${Date.now()}`;
  const ask = async (text) => {
    const reply = await withTimeout(runAgentMessage({ chatId, text }), 45000);
    transcript.push(`User: ${text}`);
    transcript.push(`Agent: ${reply}`);
    return reply;
  };

  await ask("What is missing?");
  await ask("Mark Lab as C");
  await ask("Lab 1");

  const summary = buildDbSummary(db, { includePending: true, includeIgnored: false, includeNotes: true });
  const reminders = groupReminders(listTasks(db, { status: "pending" }), timeZone);
  const summaryText = await withTimeout(
    buildAgenticTelegramSummary({
      config: getConfig(),
      summary,
      state: { lastScrapeAt: nowIso() },
      reminders,
    }),
    45000
  );

  transcript.push("Agentic daily summary:");
  transcript.push(summaryText);

  db.close();
  closeDb();
  if (fs.existsSync(dbPath)) {
    try {
      fs.unlinkSync(dbPath);
    } catch (err) {
      // leave the file if it is still locked
    }
  }

  return writeLog(transcript);
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

runSimulation()
  .then((logPath) => {
    console.log(`Live simulation log: ${logPath}`);
  })
  .catch((err) => {
    console.error(err?.message || err);
    process.exit(1);
  });
