import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDb, getChatMemory, upsertChatMemory } from "../src/db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.join(__dirname, "..", "data", "agent_chat_memory_test.db");

function cleanupDbFile() {
  for (const suffix of ["", "-shm", "-wal"]) {
    const target = `${dbPath}${suffix}`;
    if (fs.existsSync(target)) fs.unlinkSync(target);
  }
}

test("upsertChatMemory stores and increments compact count", () => {
  const db = createDb(":memory:");
  upsertChatMemory(db, {
    chatId: "chat-1",
    memoryText: "First memory summary",
    sourceResponseId: "r1",
  });
  upsertChatMemory(db, {
    chatId: "chat-1",
    memoryText: "Second memory summary",
    sourceResponseId: "r2",
  });

  const row = getChatMemory(db, "chat-1");
  assert.ok(row);
  assert.equal(row.memoryText, "Second memory summary");
  assert.equal(row.sourceResponseId, "r2");
  assert.equal(row.compactCount, 2);
});

test("runAgentMessage injects stored memory into planning input", async () => {
  cleanupDbFile();
  process.env.OPENAI_API_KEY = "test";
  process.env.OPENAI_MODEL = "gpt-5.2";
  process.env.OPENAI_MAX_OUTPUT_TOKENS = "200";
  process.env.OPENAI_COMPACT_AFTER_TURNS = "0";
  process.env.OPENAI_CAPABILITY_GUARD = "0";
  process.env.AGENT_DB_PATH = dbPath;

  const { createDb: createFileDb, closeDb, upsertChatMemory: saveMemory } = await import("../src/db.js");
  const { runAgentMessage } = await import("../src/agent.js");

  const db = createFileDb(dbPath);
  saveMemory(db, {
    chatId: "memory-chat",
    memoryText: "Remember to keep reminder formatting concise.",
    sourceResponseId: "seed",
  });
  db.close();

  const calls = [];
  const mockClient = {
    responses: {
      create: async (payload) => {
        calls.push(payload);
        return { id: "resp-1", output_text: "Done." };
      },
    },
  };

  const reply = await runAgentMessage({
    chatId: "memory-chat",
    text: "Show my reminders",
    clientOverride: mockClient,
  });

  assert.match(reply, /Done/i);
  assert.ok(calls.length >= 1);
  const input = String(calls[0].input || "");
  assert.match(input, /Persistent memory/i);
  assert.match(input, /reminder formatting concise/i);

  closeDb();
  cleanupDbFile();
});

test("runAgentMessage stores compacted memory summary when threshold is met", async () => {
  cleanupDbFile();
  process.env.OPENAI_API_KEY = "test";
  process.env.OPENAI_MODEL = "gpt-5.2";
  process.env.OPENAI_MAX_OUTPUT_TOKENS = "200";
  process.env.OPENAI_COMPACT_AFTER_TURNS = "1";
  process.env.OPENAI_CAPABILITY_GUARD = "0";
  process.env.OPENAI_DB_MEMORY_ENABLED = "1";
  process.env.AGENT_DB_PATH = dbPath;

  const { createDb: createFileDb, closeDb } = await import("../src/db.js");
  const { runAgentMessage } = await import("../src/agent.js");

  const db = createFileDb(dbPath);
  db.close();

  let createCount = 0;
  const mockClient = {
    responses: {
      create: async (_payload) => {
        createCount += 1;
        if (createCount === 1) {
          return { id: "resp-main", output_text: "Main reply." };
        }
        return { id: "resp-memory", output_text: "Keep assignment keys and pending reminders." };
      },
      compact: async (_payload) => ({ id: "resp-compacted" }),
    },
  };

  const reply = await runAgentMessage({
    chatId: "memory-chat-compact",
    text: "refresh now",
    clientOverride: mockClient,
  });
  assert.match(reply, /Main reply/i);

  const dbCheck = createFileDb(dbPath);
  const memory = getChatMemory(dbCheck, "memory-chat-compact");
  assert.ok(memory);
  assert.match(memory.memoryText, /pending reminders/i);
  const chatState = dbCheck
    .prepare(
      "SELECT last_response_id AS lastResponseId, turn_count AS turnCount FROM chat_state WHERE chat_id = ?"
    )
    .get("memory-chat-compact");
  assert.ok(chatState);
  assert.equal(chatState.lastResponseId, "resp-compacted");
  assert.equal(chatState.turnCount, 0);
  dbCheck.close();

  closeDb();
  cleanupDbFile();
});
