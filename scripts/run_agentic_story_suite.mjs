import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function toIsoTimestamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return [
    now.getUTCFullYear(),
    pad(now.getUTCMonth() + 1),
    pad(now.getUTCDate()),
    "-",
    pad(now.getUTCHours()),
    pad(now.getUTCMinutes()),
    pad(now.getUTCSeconds()),
  ].join("");
}

function seedState() {
  return {
    lastScrapeAt: "2026-02-22T12:00:00Z",
    assignments: {
      algebra_hw1: {
        key: "algebra_hw1",
        course: "Algebra",
        title: "Homework 1",
        dueDate: "3/15/26 11:59pm",
        status: "Missing",
        score: "",
        url: "",
        rawText: "",
        firstSeenAt: "2026-02-20T00:00:00Z",
        lastSeenAt: "2026-02-22T00:00:00Z",
        lastMissingAt: "2026-02-22T00:00:00Z",
        resolvedAt: null,
        isMissing: true,
      },
      latin_quiz1: {
        key: "latin_quiz1",
        course: "Latin",
        title: "Quiz 1",
        dueDate: "3/20/26 11:59pm",
        status: "Missing",
        score: "",
        url: "",
        rawText: "",
        firstSeenAt: "2026-02-20T00:00:00Z",
        lastSeenAt: "2026-02-22T00:00:00Z",
        lastMissingAt: "2026-02-22T00:00:00Z",
        resolvedAt: null,
        isMissing: true,
      },
    },
  };
}

function resetDbState(db) {
  db.exec(`
    DELETE FROM tasks;
    DELETE FROM reminders;
    DELETE FROM pending_actions;
    DELETE FROM chat_state;
  `);
}

function localHourMinute(dateLike, timeZone) {
  const date = new Date(dateLike);
  if (!Number.isFinite(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((entry) => [entry.type, entry.value]));
  return `${map.hour}:${map.minute}`;
}

function markdownTranscript(storyResult) {
  const lines = [];
  lines.push(`# Story ${storyResult.id}: ${storyResult.title}`);
  lines.push("");
  lines.push(`- Required: ${storyResult.required}`);
  lines.push(`- Heuristic pass: ${storyResult.heuristicPass}`);
  lines.push(`- Judge target: ${storyResult.judgeTarget}`);
  lines.push("");
  lines.push("## Transcript");
  lines.push("");
  for (const turn of storyResult.turns) {
    lines.push(`### Turn ${turn.turn}`);
    lines.push(`- User: ${turn.user}`);
    lines.push(`- Assistant: ${turn.assistant}`);
    lines.push(`- Tool calls: ${turn.executed.length}`);
    lines.push("");
  }
  lines.push("## Heuristic Checks");
  lines.push("");
  for (const check of storyResult.checks) {
    lines.push(`- ${check.name}: ${check.pass ? "PASS" : "FAIL"} (${check.detail})`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function findLatestTask(tasks) {
  if (!Array.isArray(tasks) || tasks.length === 0) return null;
  const sorted = [...tasks].sort((a, b) => Number(b.id || 0) - Number(a.id || 0));
  return sorted[0] || null;
}

function flattenOutputs(turns) {
  const list = [];
  for (const turn of turns) {
    for (const executed of Array.isArray(turn.executed) ? turn.executed : []) {
      list.push(executed?.output || {});
    }
  }
  return list;
}

function isManagedAgentsRequested() {
  const runtimeStack = String(process.env.RUNTIME_STACK || "").trim().toLowerCase();
  const enabled = String(process.env.MANAGED_AGENTS_ENABLED || "").trim().toLowerCase();
  return (
    runtimeStack === "managed-agents" ||
    runtimeStack === "managed_agents" ||
    ["1", "true", "yes", "y", "on"].includes(enabled)
  );
}

async function main() {
  const managedAgentsRequested = isManagedAgentsRequested();
  const storyNow = process.env.AGENTIC_STORY_NOW || "2026-05-27T12:00:00-04:00";
  const openAiKey = String(process.env.OPENAI_API_KEY || "").trim();
  if (!managedAgentsRequested && !openAiKey) {
    throw new Error("OPENAI_API_KEY is required to run the agentic story suite.");
  }

  const timestamp = toIsoTimestamp();
  const artifactRoot = path.join(repoRoot, "artifacts", "agentic-story-suite", timestamp);
  const runtimeDir = path.join(artifactRoot, "runtime");
  ensureDir(runtimeDir);

  process.env.DATA_DIR = runtimeDir;
  process.env.STATE_PATH = path.join(runtimeDir, "state.json");
  process.env.STORAGE_PATH = path.join(runtimeDir, "storage.json");
  process.env.AGENT_DB_PATH = path.join(runtimeDir, "agent.db");
  if (!managedAgentsRequested) {
    process.env.OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.2";
  }
  process.env.OPENAI_CAPABILITY_GUARD = process.env.OPENAI_CAPABILITY_GUARD || "1";
  process.env.TIMEZONE = process.env.TIMEZONE || "America/New_York";

  const state = seedState();
  fs.writeFileSync(process.env.STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  fs.writeFileSync(process.env.STORAGE_PATH, "{}\n", "utf8");

  const { createDb, closeDb, listTasks, listReminders, syncAssignmentsFromState } = await import(
    "../src/db.js"
  );
  const { runChatMessage } = await import("../src/agent_runtime.js");
  const { runReminders, computeNextReminderTime } = await import("../src/tasks.js");
  const { getConfig } = await import("../src/config.js");

  const db = createDb(process.env.AGENT_DB_PATH);
  syncAssignmentsFromState(db, state);
  db.close();

  const config = getConfig();
  const dbLive = createDb(process.env.AGENT_DB_PATH);

  const stories = [
    {
      id: "S1",
      title: "General recurring ask with no time",
      required: true,
      judgeTarget:
        "Agent creates a recurring reminder without asking for time, using defaults and explicit assumption confirmation.",
      prompts: ["Set a recurring reminder to check Schoology for missing assignments."],
      check: ({ tasks, outputs, turns }) => {
        const recurring = tasks.find((task) => String(task.recurrenceKind || "none") !== "none");
        const hasAssumptionsInOutput = outputs.some(
          (output) => Array.isArray(output.assumptions) && output.assumptions.length > 0
        );
        const hasAssumptionsInReply = turns.some((turn) =>
          /assumption|assumed|i made|if you want a different schedule|starts:/i.test(
            String(turn.assistant || "")
          )
        );
        const hasAssumptions = hasAssumptionsInOutput || hasAssumptionsInReply;
        return {
          checks: [
            {
              name: "recurring_created",
              pass: Boolean(recurring),
              detail: recurring ? `Task #${recurring.id} recurrence=${recurring.recurrenceKind}` : "No recurring task found",
            },
            {
              name: "assumptions_reported",
              pass: hasAssumptions,
              detail: hasAssumptions
                ? "Assumptions were present in tool output or assistant confirmation."
                : "No assumption evidence found in output or reply.",
            },
          ],
        };
      },
    },
    {
      id: "S2",
      title: "Frequency cue without explicit recurring wording",
      required: true,
      judgeTarget:
        "Frequency cue should infer recurrence cadence automatically (without requiring 'recurring' keyword).",
      prompts: ["Remind me every day to check in with my Algebra teacher."],
      check: ({ tasks }) => {
        const task = findLatestTask(tasks);
        const pass = Boolean(task && String(task.recurrenceKind || "none") === "daily");
        return {
          checks: [
            {
              name: "daily_inferred",
              pass,
              detail: pass ? `Task #${task.id} is daily.` : "Latest task recurrence is not daily.",
            },
          ],
        };
      },
    },
    {
      id: "S3",
      title: "Non-frequency follow-up remains one-time",
      required: true,
      judgeTarget: "A follow-up reminder with a specific time should remain one-time unless frequency cue is present.",
      prompts: ["Remind me tomorrow at 4:30 PM to follow up with my Latin teacher."],
      check: ({ tasks }) => {
        const task = findLatestTask(tasks);
        const pass = Boolean(task && String(task.recurrenceKind || "none") === "none");
        return {
          checks: [
            {
              name: "one_time_kept",
              pass,
              detail: pass ? `Task #${task.id} kept recurrence=none.` : "Latest task was set as recurring unexpectedly.",
            },
          ],
        };
      },
    },
    {
      id: "S4",
      title: "Conversational correction of cadence/time",
      required: true,
      judgeTarget: "Agent should allow follow-up correction to change cadence/time in one conversational step.",
      prompts: [
        "Create a recurring reminder to check missing assignments after school.",
        "Actually make that every day at 7:00 AM.",
      ],
      check: ({ tasks }) => {
        const task = findLatestTask(tasks);
        const recurrencePass = Boolean(task && String(task.recurrenceKind || "none") === "daily");
        const hourMinute = task ? localHourMinute(task.remindAt, "America/New_York") : "";
        const timePass = hourMinute === "07:00";
        return {
          checks: [
            {
              name: "daily_after_correction",
              pass: recurrencePass,
              detail: recurrencePass ? `Task #${task.id} updated to daily.` : "Task recurrence did not update to daily.",
            },
            {
              name: "time_after_correction",
              pass: timePass,
              detail: timePass ? "Reminder time updated to 07:00 ET." : `Reminder local time is ${hourMinute || "unknown"}.`,
            },
          ],
        };
      },
    },
    {
      id: "S5",
      title: "Cancel or stop recurring",
      required: true,
      judgeTarget: "Agent should stop recurring reminder when user asks to cancel/stop.",
      prompts: [
        "Create a recurring reminder weekdays at 4:30 PM to check Schoology.",
        "Stop that recurring reminder.",
      ],
      check: ({ tasks }) => {
        const recurringPending = tasks.filter(
          (task) => String(task.status || "") === "pending" && String(task.recurrenceKind || "none") !== "none"
        );
        return {
          checks: [
            {
              name: "no_pending_recurring",
              pass: recurringPending.length === 0,
              detail:
                recurringPending.length === 0
                  ? "No pending recurring tasks after stop request."
                  : `Found ${recurringPending.length} pending recurring task(s).`,
            },
          ],
        };
      },
    },
    {
      id: "S6",
      title: "Unsupported cadence fallback",
      required: true,
      judgeTarget: "Monthly/custom cadence should be handled with weekly fallback and explicit evidence.",
      prompts: ["Create a monthly reminder to review Schoology grades."],
      check: ({ tasks, outputs, turns }) => {
        const task = findLatestTask(tasks);
        const hasWeekly = Boolean(task && String(task.recurrenceKind || "none") === "weekly");
        const hasWarningInOutput = outputs.some((output) =>
          Array.isArray(output.warnings)
            ? output.warnings.some((value) => String(value || "").toLowerCase().includes("unsupported cadence"))
            : false
        );
        const hasWarningInReply = turns.some((turn) =>
          /not supported|fallback|weekly/i.test(String(turn.assistant || ""))
        );
        const hasWarning = hasWarningInOutput || hasWarningInReply;
        return {
          checks: [
            {
              name: "weekly_fallback",
              pass: hasWeekly,
              detail: hasWeekly ? `Task #${task.id} fallback recurrence=weekly.` : "No weekly fallback task detected.",
            },
            {
              name: "fallback_warning",
              pass: hasWarning,
              detail: hasWarning ? "Fallback warning found in tool output." : "No fallback warning found.",
            },
          ],
        };
      },
    },
    {
      id: "S7",
      title: "DST boundary recurrence consistency",
      required: true,
      judgeTarget: "Recurring weekly reminder should preserve local wall-clock time across DST transitions.",
      prompts: ["Create a weekly reminder for Sunday March 1 2026 at 8:00 AM to review missing assignments."],
      check: ({ tasks }) => {
        const task = findLatestTask(tasks);
        if (!task) {
          return {
            checks: [
              {
                name: "task_created",
                pass: false,
                detail: "No task created for DST check.",
              },
            ],
          };
        }
        const next = computeNextReminderTime(task, "America/New_York");
        const currentHm = localHourMinute(task.remindAt, "America/New_York");
        const nextHm = localHourMinute(next.toISOString(), "America/New_York");
        const currentLocalLabel = new Intl.DateTimeFormat("en-US", {
          timeZone: "America/New_York",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
          timeZoneName: "short",
        }).format(new Date(task.remindAt));
        const nextLocalLabel = new Intl.DateTimeFormat("en-US", {
          timeZone: "America/New_York",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
          timeZoneName: "short",
        }).format(next);
        const pass = currentHm !== "" && currentHm === nextHm;
        return {
          checks: [
            {
              name: "wall_clock_preserved",
              pass,
              detail: pass
                ? `Local time preserved across DST: ${currentLocalLabel} -> ${nextLocalLabel}.`
                : `Local time changed across DST: ${currentLocalLabel} -> ${nextLocalLabel}.`,
            },
          ],
          evidence: {
            dstCurrentLocal: currentLocalLabel,
            dstNextLocal: nextLocalLabel,
            dstNextIso: next.toISOString(),
          },
        };
      },
    },
    {
      id: "S8",
      title: "One-time rollover regression check",
      required: true,
      judgeTarget: "One-time reminders should still roll forward by one day after firing.",
      prompts: ["Remind me on 2026-03-10 at 9:00 PM to turn in my permission slip."],
      check: async ({ tasks }) => {
        const task = findLatestTask(tasks);
        if (!task) {
          return {
            checks: [
              {
                name: "task_created",
                pass: false,
                detail: "No one-time task was created.",
              },
            ],
          };
        }
        await runReminders({
          config,
          dbOverride: dbLive,
          nowOverride: "2026-03-11T02:00:00Z",
          senders: {
            telegramRaw: async () => {},
          },
        });
        const post = listTasks(dbLive, { status: "all" });
        const updated = post.find((row) => Number(row.id) === Number(task.id));
        const passRecurrence = Boolean(updated && String(updated.recurrenceKind || "none") === "none");
        const passRolled = Boolean(updated && Number(updated.rollCount || 0) >= 1);
        const beforeLabel = task?.remindAt || null;
        const afterLabel = updated?.remindAt || null;
        return {
          checks: [
            {
              name: "remains_one_time",
              pass: passRecurrence,
              detail: passRecurrence ? "Recurrence stayed as none." : "Recurrence changed unexpectedly.",
            },
            {
              name: "rollover_occurs",
              pass: passRolled,
              detail: passRolled
                ? `rollCount=${updated.rollCount}; remindAt advanced ${beforeLabel} -> ${afterLabel}.`
                : "Task did not roll over.",
            },
          ],
          evidence: {
            beforeRemindAt: beforeLabel,
            afterRemindAt: afterLabel,
            postTask: updated || null,
          },
        };
      },
    },
  ];

  const storyResults = [];
  for (const story of stories) {
    resetDbState(dbLive);
    syncAssignmentsFromState(dbLive, seedState());
    const chatId = `story-${story.id}-${Date.now()}`;
    const turns = [];

    for (let idx = 0; idx < story.prompts.length; idx += 1) {
      const userText = story.prompts[idx];
      const response = await runChatMessage({ chatId, text: userText, now: storyNow, debug: true });
      const assistantText =
        response && typeof response === "object" && typeof response.reply === "string"
          ? response.reply
          : String(response || "");
      const executed =
        response && typeof response === "object" && Array.isArray(response.executed)
          ? response.executed
          : [];
      turns.push({
        turn: idx + 1,
        user: userText,
        assistant: assistantText,
        executed,
      });
    }

    const tasksBeforeCheck = listTasks(dbLive, { status: "all" });
    const remindersBeforeCheck = listReminders(dbLive, { status: "all" });
    const outputs = flattenOutputs(turns);
    const checkResult = await story.check({
      tasks: tasksBeforeCheck,
      reminders: remindersBeforeCheck,
      outputs,
      turns,
    });
    const tasksAfterCheck = listTasks(dbLive, { status: "all" });
    const remindersAfterCheck = listReminders(dbLive, { status: "all" });
    const checks = Array.isArray(checkResult?.checks) ? checkResult.checks : [];
    const heuristicPass = checks.every((check) => check.pass === true);

    const storyResult = {
      id: story.id,
      title: story.title,
      required: story.required === true,
      judgeTarget: story.judgeTarget,
      heuristicPass,
      prompts: story.prompts,
      turns,
      checks,
      evidence: checkResult?.evidence || null,
      snapshots: {
        before: {
          tasks: tasksBeforeCheck,
          reminders: remindersBeforeCheck,
        },
        after: {
          tasks: tasksAfterCheck,
          reminders: remindersAfterCheck,
        },
      },
    };
    storyResults.push(storyResult);

    const storyDir = path.join(artifactRoot, "stories", story.id);
    ensureDir(storyDir);
    writeJson(path.join(storyDir, "story.json"), storyResult);
    fs.writeFileSync(path.join(storyDir, "transcript.md"), markdownTranscript(storyResult), "utf8");
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    model: process.env.OPENAI_MODEL || "gpt-5.2",
    runtimeStack: managedAgentsRequested ? "managed-agents" : "legacy-openai",
    managedAgentsEnabled: managedAgentsRequested,
    storyNow,
    timezone: process.env.TIMEZONE || "America/New_York",
    artifactRoot,
    stories: storyResults.map((story) => ({
      id: story.id,
      title: story.title,
      required: story.required,
      heuristicPass: story.heuristicPass,
      checks: story.checks,
    })),
  };

  writeJson(path.join(artifactRoot, "story-suite-manifest.json"), manifest);
  writeJson(path.join(artifactRoot, "story-suite-full.json"), storyResults);

  dbLive.close();
  closeDb();

  const failingRequired = storyResults.filter((story) => story.required && !story.heuristicPass);
  if (failingRequired.length > 0) {
    console.error("Agentic story suite completed with heuristic failures.");
    for (const story of failingRequired) {
      console.error(`- ${story.id}: ${story.title}`);
    }
    console.error(`Artifacts: ${artifactRoot}`);
    process.exit(1);
  }

  console.log(`Agentic story suite completed. Artifacts: ${artifactRoot}`);
}

main().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
