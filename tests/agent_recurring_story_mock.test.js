import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.join(__dirname, "..", "data", "agent_recurring_story_mock.db");

function createMockClient(responses) {
  const queue = [...responses];
  return {
    responses: {
      create: async () => {
        if (queue.length === 0) throw new Error("Mock responses exhausted");
        return queue.shift();
      },
    },
  };
}

function functionCallResponse(id, name, args, callId) {
  return {
    id,
    output: [
      {
        type: "function_call",
        name,
        arguments: JSON.stringify(args || {}),
        call_id: callId || `call_${id}`,
      },
    ],
  };
}

function textResponse(id, text) {
  return { id, output_text: text };
}

async function cleanupDb() {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  throw new Error(`Failed to delete ${dbPath}`);
}

test("agent recurring story uses assumptions and supports correction flow", async () => {
  process.env.OPENAI_API_KEY = "test";
  process.env.OPENAI_MODEL = "gpt-5.2";
  process.env.OPENAI_MAX_OUTPUT_TOKENS = "250";
  process.env.OPENAI_COMPACT_AFTER_TURNS = "0";
  process.env.OPENAI_CAPABILITY_GUARD = "0";
  process.env.AGENT_DB_PATH = dbPath;
  process.env.TIMEZONE = "America/New_York";

  const { createDb, closeDb, syncAssignmentsFromState, listReminders } = await import("../src/db.js");
  const { runAgentMessage } = await import("../src/agent.js");

  await cleanupDb();
  const db = createDb(dbPath);
  syncAssignmentsFromState(db, {
    assignments: {
      a1: {
        key: "a1",
        course: "Algebra",
        title: "Homework 1",
        dueDate: "2026-03-15",
        status: "Missing",
        score: "",
        url: "",
        rawText: "",
        firstSeenAt: "2026-02-20T00:00:00Z",
        lastSeenAt: "2026-02-20T00:00:00Z",
        lastMissingAt: "2026-02-20T00:00:00Z",
        resolvedAt: null,
        isMissing: true,
      },
    },
  });
  db.close();

  const chatId = `recurring-story-${Date.now()}`;
  const createMock = createMockClient([
    functionCallResponse(
      "r1",
      "schedule_reminder",
      {
        key: "a1",
        remindAt: null,
        recurrence: null,
        message: "Check missing work",
      },
      "call_create_0"
    ),
    textResponse("r2", ""),
  ]);

  const firstReply = await runAgentMessage({
    chatId,
    text: "Set a recurring reminder to check missing work for homework 1.",
    clientOverride: createMock,
  });
  assert.match(firstReply, /Created recurring reminder/i);
  assert.match(firstReply, /Quick edit:/i);

  const inspectDb = createDb(dbPath);
  const reminder = listReminders(inspectDb, { key: "a1", status: "pending" })[0];
  inspectDb.close();
  assert.ok(reminder);

  const updateMock = createMockClient([
    functionCallResponse(
      "r3",
      "update_assignment_reminder",
      {
        id: reminder.id,
        remindAt: "tomorrow at 7:00am",
        recurrence: "daily",
      },
      "call_update_0"
    ),
    textResponse("r4", ""),
  ]);

  const secondReply = await runAgentMessage({
    chatId,
    text: "Actually make that every day at 7:00 AM.",
    clientOverride: updateMock,
  });

  assert.match(secondReply, /Updated reminder/i);
  assert.match(secondReply, /Daily/i);

  closeDb();
  await cleanupDb();
});
