import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium } from "playwright";
import {
  closeDb,
  getDb,
  recordManagedAgentEvent,
  upsertManagedAgentSession,
} from "../src/db.js";
import { writeServiceHeartbeat } from "../src/health.js";
import { runToolByName } from "../src/tool_runner.js";
import {
  makeDashboardConfig,
  makeDashboardTempDir,
  seedDashboardAssignments,
  seedDashboardStateFile,
  seedDashboardTasks,
  startDashboardServer,
} from "./dashboard_test_utils.js";

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
  const tempDir = makeDashboardTempDir("schoology-dashboard-ui-");
  const config = makeDashboardConfig(tempDir);
  seedDashboardStateFile(config);
  const db = getDb(config);
  seedDashboardAssignments(db);
  seedDashboardTasks(db);

  const toolExecutor = async (toolDb, tool, args, context) => {
    if (tool === "refresh_schoology") {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      return { ok: true, actionableCount: 1, pendingCount: 1, ignoredCount: 0 };
    }
    return runToolByName(toolDb, tool, args, context);
  };

  let browser;
  let stop = async () => {};
  try {
    browser = await launchChromiumOrSkip(t);
    if (!browser) return;

    const serverRuntime = await startDashboardServer({ config, logger: { log: () => {} }, toolExecutor });
    const { port } = serverRuntime;
    stop = serverRuntime.stop;
    assert.ok(port > 0);

    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" });

    await page.waitForSelector("text=Tonight's Plan");
    await page.waitForSelector("text=Waiting on Teacher");

    await page.locator('.nav-item[data-view="admin"]').click();
    await page.waitForSelector("text=Refresh Schoology");
    const refreshButton = page.locator('[data-view-panel="admin"] [data-action="refresh-assignments"]').first();
    await refreshButton.click();
    await page.waitForFunction(() => {
      const text = document.querySelector('[data-view-panel="admin"] [data-action="refresh-assignments"]')?.textContent || "";
      return /Refreshing\.\.\./.test(text);
    });
    await page.waitForFunction(() => {
      const text = document.getElementById("flash")?.textContent || "";
      return /Refresh complete\. 1 need attention, 1 waiting on school, 0 handled for now\. Finished in /.test(text);
    });
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
    assert.ok(
      await page.locator('.outcome-option').filter({ hasText: "Will complete in class" }).first().isVisible()
    );

    let detail = await fetch(`http://127.0.0.1:${port}/api/assignments/a1/detail`).then((response) => response.json());
    assert.equal(detail.notes.length, 0);
    assert.equal(detail.assignment.manualStatus || "", "");

    await page.locator('.outcome-option').filter({ hasText: "Will complete in class" }).first().click();
    await page.getByRole("button", { name: "Save status" }).click();
    await page.waitForSelector("text=Marked as will complete in class.");

    detail = await fetch(`http://127.0.0.1:${port}/api/assignments/a1/detail`).then((response) => response.json());
    assert.equal(detail.notes.length, 0);
    assert.equal(detail.assignment.manualStatus, "Will complete in class");

    await page.locator(".outcome-option").filter({ hasText: "Submitted" }).first().click();
    detail = await fetch(`http://127.0.0.1:${port}/api/assignments/a1/detail`).then((response) => response.json());
    assert.equal(detail.notes.length, 0);
    assert.equal(detail.assignment.manualStatus, "Will complete in class");

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
    assert.ok(
      (await page.locator('#bulkStatusSelect option').filter({ hasText: "Will complete in class" }).count()) > 0
    );

    await page.close();
  } finally {
    if (browser) await browser.close();
    await stop().catch(() => {});
    closeDb();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("dashboard admin renders managed agent status and alerts", async (t) => {
  const tempDir = makeDashboardTempDir("schoology-dashboard-managed-ui-");
  const config = makeDashboardConfig(tempDir);
  config.runtime = { stack: "managed-agents" };
  config.managedAgents = {
    enabled: true,
    environment: "dev",
    sessionNamespace: "schoology-dev",
    sessionTtlMinutes: 60,
    idleTimeoutMinutes: 10,
  };
  seedDashboardStateFile(config);
  const db = getDb(config);
  seedDashboardAssignments(db);
  upsertManagedAgentSession(db, {
    chatId: "chat-1",
    environment: "schoology-dev",
    sessionId: "sesn_managed_ui",
    status: "active",
    createdAt: "2026-02-16T16:30:00Z",
    updatedAt: "2026-02-16T16:58:00Z",
    lastEventAt: "2026-02-16T16:58:00Z",
    expiresAt: "2026-02-16T17:30:00Z",
    metadata: { lastEventType: "telegram_message" },
  });
  recordManagedAgentEvent(db, {
    chatId: "chat-1",
    environment: "schoology-dev",
    sessionId: "sesn_managed_ui",
    eventType: "turn_error",
    status: "error",
    summary: "Managed turn failed.",
    createdAt: "2026-02-16T16:58:00Z",
  });
  writeServiceHeartbeat(config, "scheduler", { status: "running" });
  writeServiceHeartbeat(config, "telegram-agent", { status: "running" });
  writeServiceHeartbeat(config, "managed-agent-bridge", { status: "running" });

  let browser;
  let stop = async () => {};
  try {
    browser = await launchChromiumOrSkip(t);
    if (!browser) return;

    const serverRuntime = await startDashboardServer({ config, logger: { log: () => {} } });
    const { port } = serverRuntime;
    stop = serverRuntime.stop;

    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" });
    await page.locator('.nav-item[data-view="admin"]').click();
    await page.waitForFunction(() => {
      return Array.from(document.querySelectorAll(".panel")).some((panel) => {
        const text = panel.textContent || "";
        return (
          text.includes("Managed Agents") &&
          text.includes("Needs review") &&
          text.includes("turn_error") &&
          text.includes("Managed turn failed.")
        );
      });
    });

    const dotTitle = await page.locator("#systemStatusDot").getAttribute("title");
    assert.match(dotTitle || "", /managed agent need review/i);
    await page.close();
  } finally {
    if (browser) await browser.close();
    await stop().catch(() => {});
    closeDb();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
