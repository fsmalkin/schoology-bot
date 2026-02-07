import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runSend } from "../src/tasks.js";
import { loadState, saveState } from "../src/storage.js";
import { closeDb } from "../src/db.js";

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "schoology-send-"));
}

function makeConfig(tempDir) {
  return {
    schoology: {
      loginUrl: "https://example.com",
      gradesUrl: "https://example.com",
      username: "user",
      password: "pass",
      studentName: "Test Student",
      idp: "auto",
      ssoSchool: "",
    },
    schedule: {
      timezone: "America/New_York",
      scrapeCron: "0 6 * * *",
      sendCron: "0 7 * * *",
      reminderCron: "*/1 * * * *",
    },
    email: {},
    twilio: {},
    telegram: {
      botToken: "test-token",
      chatIds: ["123"],
    },
    github: {},
    openai: {
      apiKey: "",
      model: "gpt-5.2",
      reasoningEffort: "high",
      maxOutputTokens: 2000,
      compactAfterTurns: 20,
    },
    autoIgnore: { enabled: false, oldDays: 120, keywords: [] },
    autoUpcoming: { enabled: false, days: 7, remindHour: 16, remindMinute: 0 },
    delivery: { channel: "telegram" },
    liveChecks: { enabled: false, cron: "0 5 * * *", chatIds: [] },
    debug: { dump: false },
    paths: {
      dataDir: tempDir,
      statePath: path.join(tempDir, "state.json"),
      storagePath: path.join(tempDir, "storage.json"),
      debugHtmlPath: path.join(tempDir, "debug.html"),
      debugScreenshotPath: path.join(tempDir, "debug.png"),
      agentDbPath: path.join(tempDir, "agent.db"),
      bugLogPath: path.join(tempDir, "bugs.log"),
    },
  };
}

function seedState(statePath) {
  const state = {
    meta: { createdAt: new Date().toISOString() },
    lastScrapeAt: new Date().toISOString(),
    lastSummarySentAt: null,
    assignments: {},
  };
  saveState(statePath, state);
  return state;
}

test("runSend updates lastSummarySentAt on success", async () => {
  const tempDir = makeTempDir();
  const config = makeConfig(tempDir);
  seedState(config.paths.statePath);
  let calls = 0;
  try {
    await runSend({
      config,
      skipValidate: true,
      senders: {
        telegram: async () => {
          calls += 1;
        },
      },
    });
    assert.equal(calls, 1);
    const nextState = loadState(config.paths.statePath);
    assert.ok(nextState.lastSummarySentAt);
  } finally {
    closeDb();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("runSend does not update lastSummarySentAt on failure", async () => {
  const tempDir = makeTempDir();
  const config = makeConfig(tempDir);
  seedState(config.paths.statePath);
  try {
    await assert.rejects(
      runSend({
        config,
        skipValidate: true,
        senders: {
          telegram: async () => {
            throw new Error("send failed");
          },
        },
      }),
      /send failed/i
    );
    const nextState = loadState(config.paths.statePath);
    assert.equal(nextState.lastSummarySentAt, null);
  } finally {
    closeDb();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
