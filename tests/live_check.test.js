import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runLiveCheck } from "../src/tasks.js";
import { closeDb } from "../src/db.js";

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "schoology-live-"));
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
      chatIds: ["111"],
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
    liveChecks: { enabled: true, cron: "0 5 * * *", chatIds: ["999"] },
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

test("runLiveCheck uses live check chat IDs when provided", async () => {
  const tempDir = makeTempDir();
  const config = makeConfig(tempDir);
  let usedChatIds = null;
  try {
    const result = await runLiveCheck({
      config,
      skipValidate: true,
      senders: {
        telegramRaw: async (cfg) => {
          usedChatIds = cfg.telegram.chatIds;
        },
      },
    });
    assert.equal(result.ok, true);
    assert.deepEqual(usedChatIds, ["999"]);
  } finally {
    closeDb();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
