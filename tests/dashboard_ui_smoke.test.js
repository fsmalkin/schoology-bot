import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { closeDb, getDb } from "../src/db.js";
import { createDashboardServer } from "../src/dashboard_server.js";
import { runToolByName } from "../src/tool_runner.js";

function makeConfig(tempDir) {
  return {
    schedule: {
      timezone: "America/New_York",
      scrapeCron: "0 6 * * *",
      sendCron: "0 7 * * *",
      reminderCron: "*/1 * * * *",
    },
    liveChecks: {
      enabled: false,
      cron: "0 5 * * *",
    },
    paths: {
      dataDir: tempDir,
      statePath: path.join(tempDir, "state.json"),
      agentDbPath: path.join(tempDir, "agent.db"),
    },
  };
}

function seedStateFile(config) {
  fs.writeFileSync(
    config.paths.statePath,
    JSON.stringify(
      {
        meta: { createdAt: new Date().toISOString() },
        lastScrapeAt: "2026-02-16T11:00:00Z",
        lastSummarySentAt: "2026-02-16T12:00:00Z",
        assignments: {},
      },
      null,
      2
    ),
    "utf8"
  );
}

function seedAssignments(db) {
  db.prepare(
    `
    INSERT INTO assignments (
      key, course, title, due_date, status, score, url, raw_text,
      first_seen_at, last_seen_at, last_missing_at, resolved_at, is_missing, manual_status, auto_ignored
    )
    VALUES
      ('a1', 'Algebra: Sec 1', 'Homework 1', '2/15/26 11:59pm', 'Missing', '', 'https://schoology.local/a1', '', '2026-02-10T00:00:00Z', '2026-02-16T00:00:00Z', '2026-02-16T00:00:00Z', NULL, 1, NULL, 0),
      ('a2', 'Latin: Sec 1', 'Quiz 1', '2/21/26 11:59pm', 'Missing', '', '', '', '2026-02-10T00:00:00Z', '2026-02-16T00:00:00Z', '2026-02-16T00:00:00Z', NULL, 1, 'Waiting on teacher', 0)
  `
  ).run();
}

function seedTasks(db) {
  db.prepare(
    `
    INSERT INTO tasks (
      assignment_key, title, message, remind_at, status, kind, recurrence_kind, recurrence_tz, auto_cancel_on_resolve, auto_planned, created_at
    )
    VALUES
      (NULL, 'Ask teacher', 'follow up tomorrow', '2026-02-16T22:00:00Z', 'pending', 'personal', 'none', NULL, 0, 0, '2026-02-10T00:00:00Z')
  `
  ).run();
}

async function launchChromiumOrSkip(t) {
  try {
    return await chromium.launch({ headless: true });
  } catch (err) {
    const message = String(err?.message || err);
    if (message.includes("Executable doesn't exist") || message.includes("browserType.launch")) {
      t.skip("Playwright Chromium is not installed in this environment.");
      return null;
    }
    throw err;
  }
}

test("dashboard card interactions open the review drawer and keep writes explicit", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "schoology-dashboard-ui-"));
  const config = makeConfig(tempDir);
  seedStateFile(config);
  const db = getDb(config);
  seedAssignments(db);
  seedTasks(db);

  const toolExecutor = async (toolDb, tool, args, context) => {
    if (tool === "refresh_schoology") {
      await new Promise((resolve) => setTimeout(resolve, 120));
      return { ok: true, actionableCount: 1, pendingCount: 1, ignoredCount: 0 };
    }
    return runToolByName(toolDb, tool, args, context);
  };

  const server = createDashboardServer({ config, logger: { log: () => {} }, toolExecutor });
  let browser;
  try {
    browser = await launchChromiumOrSkip(t);
    if (!browser) return;

    await server.start(0);
    const address = server.server.address();
    const port = address && typeof address === "object" ? address.port : 0;
    assert.ok(port > 0);

    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" });

    await page.waitForSelector("text=Tonight's Plan");
    await page.waitForSelector("text=Waiting on Teacher");

    await page.locator('.nav-item[data-view="admin"]').click();
    await page.waitForSelector("text=Refresh Schoology");
    const refreshButton = page.locator('[data-view-panel="admin"] [data-action="refresh-assignments"]').first();
    await refreshButton.click();
    await page.waitForSelector("text=Refreshing Schoology...");
    await page.waitForSelector("text=Refresh complete. 1 need attention, 1 waiting on school, 0 handled for now.");
    assert.equal((await refreshButton.textContent())?.trim().replace(/\s+/g, " "), "Refresh Schoology");
    await page.getByRole("button", { name: "Tonight's Plan" }).click();

    const assignmentCards = page.locator('[data-surface-card="assignment"]');
    assert.ok((await assignmentCards.count()) > 0);
    assert.equal(await assignmentCards.first().locator("text=Review and update").count(), 0);
    assert.equal(await assignmentCards.first().locator("text=Submitted").count(), 0);

    await assignmentCards.first().click();
    await page.waitForFunction(() => document.getElementById("detailDrawer")?.dataset.open === "true");
    await page.waitForSelector("text=Save status");
    assert.ok(await page.getByRole("button", { name: "Save status" }).isVisible());
    assert.equal(await page.getByRole("button", { name: /Create reminder|Save reminder/ }).count(), 0);
    assert.equal(await page.getByRole("button", { name: "Save note" }).count(), 0);

    let detail = await fetch(`http://127.0.0.1:${port}/api/assignments/a1/detail`).then((response) => response.json());
    assert.equal(detail.notes.length, 0);
    assert.equal(detail.assignment.manualStatus || "", "");

    await page.locator(".outcome-option").filter({ hasText: "Submitted" }).first().click();
    detail = await fetch(`http://127.0.0.1:${port}/api/assignments/a1/detail`).then((response) => response.json());
    assert.equal(detail.notes.length, 0);
    assert.equal(detail.assignment.manualStatus || "", "");

    await page.getByRole("button", { name: "Save status" }).click();
    await page.waitForSelector("text=Marked submitted and moved to waiting on teacher.");

    detail = await fetch(`http://127.0.0.1:${port}/api/assignments/a1/detail`).then((response) => response.json());
    assert.equal(detail.notes.length, 1);
    assert.equal(detail.assignment.manualStatus, "Waiting on teacher");

    await page.locator('[data-action="open-drawer-section"][data-section="reminder"]').click();
    await page.waitForSelector('button:has-text("Create reminder"), button:has-text("Save reminder")');
    assert.equal(await page.getByRole("button", { name: "Save status" }).count(), 0);

    await page.locator('[data-action="open-drawer-section"][data-section="notes"]').click();
    await page.waitForSelector('button:has-text("Save note")');
    assert.equal(await page.getByRole("button", { name: /Create reminder|Save reminder/ }).count(), 0);

    await page.locator("#drawerBackdrop").click();
    await page.waitForFunction(() => document.getElementById("detailDrawer")?.dataset.open === "false");

    await page.setViewportSize({ width: 390, height: 844 });
    await assignmentCards.first().click();
    await page.waitForFunction(() => document.getElementById("detailDrawer")?.dataset.open === "true");
    const mobileDrawerBox = await page.locator("#detailDrawer").boundingBox();
    assert.ok(mobileDrawerBox && mobileDrawerBox.width >= 360);
    await page.locator('#detailDrawer button[data-action="close-drawer"]').click();
    await page.waitForFunction(() => document.getElementById("detailDrawer")?.dataset.open === "false");

    const followupCards = page.locator('[data-surface-card="task"]');
    assert.ok((await followupCards.count()) > 0);
    await followupCards.first().click();
    await page.waitForFunction(() => document.getElementById("detailDrawer")?.dataset.open === "true");
    await page.waitForSelector("text=Save follow-up");
    assert.ok(await page.getByRole("button", { name: "Save follow-up" }).isVisible());
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => document.getElementById("detailDrawer")?.dataset.open === "false");

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByRole("button", { name: "All Schoolwork" }).click();
    await page.waitForSelector("text=Bulk select");
    assert.equal(await page.locator('[data-action="toggle-assignment-select"]').count(), 0);

    await page.getByRole("button", { name: "Bulk select" }).click();
    assert.ok((await page.locator('[data-action="toggle-assignment-select"]').count()) > 0);

    await page.close();
  } finally {
    if (browser) await browser.close();
    await server.stop().catch(() => {});
    closeDb();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
