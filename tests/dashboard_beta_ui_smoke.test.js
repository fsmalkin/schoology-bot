import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium } from "playwright";
import { closeDb, getDb } from "../src/db.js";
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

async function readJson(url) {
  const response = await fetch(url);
  assert.equal(response.status, 200, `Expected 200 from ${url}`);
  return await response.json();
}

async function waitForDrawerOpen(page) {
  await page.waitForFunction(() => document.getElementById("detailDrawer")?.dataset.open === "true");
}

async function waitForDrawerClosed(page) {
  await page.waitForFunction(() => document.getElementById("detailDrawer")?.dataset.open === "false");
}

async function waitForDrawerTitle(page, title) {
  await page.waitForFunction(
    (expected) => document.getElementById("drawerTitle")?.textContent?.trim() === expected,
    title
  );
}

async function waitForAssignmentDrawerReady(page) {
  await page.waitForSelector('#drawerContent [data-action="beta-toggle-section"][data-section="reminder"]');
  await page.waitForSelector('#drawerContent [data-action="beta-toggle-section"][data-section="notes"]');
}

async function waitForFocusId(page, id) {
  await page.waitForFunction((expectedId) => document.activeElement?.id === expectedId, id);
}

async function waitForFocusedAssignment(page, key) {
  await page.waitForFunction(
    (expectedKey) => document.activeElement?.getAttribute("data-open-assignment-key") === expectedKey,
    key
  );
}

async function ensureReminderSectionOpen(page) {
  await waitForAssignmentDrawerReady(page);
  const reminderForm = page.locator('#drawerContent form[data-form="assignment-drawer-reminder"]');
  if ((await reminderForm.count()) === 0) {
    await page.locator('#drawerContent [data-action="beta-toggle-section"][data-section="reminder"]').click();
    await page.waitForSelector('#drawerContent form[data-form="assignment-drawer-reminder"]', { state: "attached" });
  }
}

function createDelayGate() {
  let hitResolve = () => {};
  let releaseResolve = () => {};
  let servedResolve = () => {};
  let hitMarked = false;
  let released = false;
  let served = false;

  return {
    hit: new Promise((resolve) => {
      hitResolve = resolve;
    }),
    wait: new Promise((resolve) => {
      releaseResolve = resolve;
    }),
    served: new Promise((resolve) => {
      servedResolve = resolve;
    }),
    markHit() {
      if (hitMarked) return;
      hitMarked = true;
      hitResolve();
    },
    release() {
      if (released) return;
      released = true;
      releaseResolve();
    },
    markServed() {
      if (served) return;
      served = true;
      servedResolve();
    },
  };
}

test("beta dashboard boots cleanly and keeps assignment drawer flows explicit", async (t) => {
  const tempDir = makeDashboardTempDir("schoology-beta-ui-");
  const config = makeDashboardConfig(tempDir);
  seedDashboardStateFile(config);
  const db = getDb(config);
  seedDashboardAssignments(db);
  seedDashboardTasks(db);

  const toolExecutor = async (toolDb, tool, args, context) => {
    if (tool === "refresh_schoology") {
      await new Promise((resolve) => setTimeout(resolve, 120));
      return { ok: true, actionableCount: 1, pendingCount: 1, ignoredCount: 0 };
    }
    return runToolByName(toolDb, tool, args, context);
  };

  let browser;
  let stop = async () => {};
  const consoleErrors = [];
  const pageErrors = [];

  try {
    browser = await launchChromiumOrSkip(t);
    if (!browser) return;

    const serverRuntime = await startDashboardServer({ config, logger: { log: () => {} }, toolExecutor });
    const { port } = serverRuntime;
    stop = serverRuntime.stop;
    assert.ok(port > 0);

    const page = await browser.newPage();
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => {
      pageErrors.push(String(err?.stack || err));
    });

    await page.goto(`http://127.0.0.1:${port}/beta`, { waitUntil: "networkidle" });
    await page.waitForSelector(".beta-badge");
    assert.equal(await page.locator("#topbarViewLabel").textContent(), "Tonight's Plan");
    assert.equal(await page.locator('[data-view-panel="home"]').isVisible(), true);
    assert.equal(await page.locator('[data-view-panel="schoolwork"]').isVisible(), false);
    assert.equal(await page.locator('[data-view-panel="admin"]').isVisible(), false);

    await page.locator('.nav-item[data-view="schoolwork"]').click();
    await page.waitForSelector('[data-view-panel="schoolwork"]:not([hidden])');
    assert.equal(await page.locator("#topbarViewLabel").textContent(), "All Schoolwork");

    await page.locator('.nav-item[data-view="home"]').click();
    await page.waitForSelector('[data-view-panel="home"]:not([hidden])');
    assert.equal(await page.locator("#topbarViewLabel").textContent(), "Tonight's Plan");

    await page.locator('.nav-item[data-view="admin"]').click();
    await page.waitForSelector('[data-view-panel="admin"]:not([hidden])');
    assert.equal(await page.locator("#topbarViewLabel").textContent(), "System Health");

    const refreshButton = page.getByRole("button", { name: "Refresh Schoology" });
    await refreshButton.click();
    await page.waitForSelector("text=Refreshing Schoology...");
    await page.waitForSelector("text=Refresh complete. 1 need attention, 1 waiting on school, 0 handled for now.");
    assert.match((await refreshButton.textContent()) || "", /Refresh Schoology/);

    await page.locator('.nav-item[data-view="schoolwork"]').click();
    await page.waitForSelector('[data-view-panel="schoolwork"]:not([hidden])');

    const assignmentKey = "a1";
    const assignmentCard = page.locator('[data-view-panel="schoolwork"] [data-surface-card="assignment"]').first();
    assert.equal(await assignmentCard.getAttribute("data-open-assignment-key"), assignmentKey);
    assert.equal(await page.locator('[data-view-panel="schoolwork"] [data-surface-card="assignment"] button').count(), 0);

    await assignmentCard.click();
    await waitForDrawerOpen(page);
    await waitForDrawerTitle(page, "Homework 1");
    assert.equal(await page.locator('form[data-form="assignment-status"]').isVisible(), true);
    assert.equal(await page.locator('form[data-form="assignment-drawer-reminder"]').count(), 0);
    assert.equal(await page.locator('form[data-form="assignment-drawer-note"]').count(), 0);

    await page.locator('label.outcome-option').filter({ has: page.locator('input[name="outcome"][value="waiting_teacher"]') }).click();
    const beforeStatusSave = await readJson(`http://127.0.0.1:${port}/api/assignments/a1/detail`);
    assert.equal(beforeStatusSave.assignment.manualStatus || "", "");

    await page.locator('form[data-form="assignment-status"] button[type="submit"]').click();
    await page.waitForSelector("text=Marked as waiting on teacher.");
    await waitForAssignmentDrawerReady(page);
    const afterStatusSave = await readJson(`http://127.0.0.1:${port}/api/assignments/a1/detail`);
    assert.equal(afterStatusSave.assignment.manualStatus, "Waiting on teacher");

    await ensureReminderSectionOpen(page);
    await page.locator('#drawerContent input[name="remindAt"]').fill("2026-03-20T12:00");
    await page.locator('#drawerContent select[name="recurrence"]').selectOption("weekly");
    await page.locator('#drawerContent input[name="message"]').fill("Check with teacher");
    await page.locator('#drawerContent form[data-form="assignment-drawer-reminder"] button[type="submit"]').click();
    await page.waitForSelector("text=Reminder saved.");
    await waitForAssignmentDrawerReady(page);
    let assignmentDetail = await readJson(`http://127.0.0.1:${port}/api/assignments/a1/detail`);
    assert.equal(assignmentDetail.pendingReminder?.message, "Check with teacher");
    assert.equal(assignmentDetail.pendingReminder?.recurrenceKind, "weekly");

    await ensureReminderSectionOpen(page);
    await page.locator('#drawerContent input[name="message"]').fill("Updated reminder");
    await page.locator('#drawerContent select[name="recurrence"]').selectOption("none");
    await page.locator('#drawerContent form[data-form="assignment-drawer-reminder"] button[type="submit"]').click();
    await page.waitForSelector("text=Reminder saved.");
    await waitForAssignmentDrawerReady(page);
    assignmentDetail = await readJson(`http://127.0.0.1:${port}/api/assignments/a1/detail`);
    assert.equal(assignmentDetail.pendingReminder?.message, "Updated reminder");

    await page.locator('#drawerContent button[data-action="delete-reminder"]').click();
    await page.waitForSelector("text=Reminder deleted.");
    await waitForAssignmentDrawerReady(page);
    assignmentDetail = await readJson(`http://127.0.0.1:${port}/api/assignments/a1/detail`);
    assert.equal(assignmentDetail.pendingReminder, null);

    await page.locator("#drawerBackdrop").click();
    await waitForDrawerClosed(page);
    await waitForFocusedAssignment(page, assignmentKey);

    const currentAssignmentCard = page.locator(
      `[data-view-panel="schoolwork"]:not([hidden]) [data-open-assignment-key="${assignmentKey}"]`
    ).first();
    const currentAssignmentCardId = await currentAssignmentCard.getAttribute("id");
    assert.ok(currentAssignmentCardId);
    await currentAssignmentCard.focus();
    await page.keyboard.press("Enter");
    await waitForDrawerOpen(page);
    await page.keyboard.press("Escape");
    await waitForDrawerClosed(page);
    await waitForFocusId(page, currentAssignmentCardId);

    await page.setViewportSize({ width: 390, height: 844 });
    await currentAssignmentCard.click();
    await waitForDrawerOpen(page);
    const mobileDrawerBox = await page.locator("#detailDrawer").boundingBox();
    assert.ok(mobileDrawerBox && mobileDrawerBox.width >= 350);
    await page.keyboard.press("Escape");
    await waitForDrawerClosed(page);
    await page.setViewportSize({ width: 1280, height: 900 });

    assert.equal(consoleErrors.length, 0, consoleErrors.join("\n"));
    assert.equal(pageErrors.length, 0, pageErrors.join("\n"));
  } finally {
    if (browser) await browser.close();
    await stop().catch(() => {});
    closeDb();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("beta dashboard supports task CRUD and surfaces Submitted partial failures", async (t) => {
  const tempDir = makeDashboardTempDir("schoology-beta-ui-task-");
  const config = makeDashboardConfig(tempDir);
  seedDashboardStateFile(config);
  const db = getDb(config);
  seedDashboardAssignments(db);
  seedDashboardTasks(db);

  let submittedNoteFailures = 0;
  const toolExecutor = async (toolDb, tool, args, context) => {
    if (tool === "add_assignment_note" && args?.note === "Marked submitted from dashboard." && submittedNoteFailures === 0) {
      submittedNoteFailures += 1;
      return { ok: false, error: "Simulated note failure." };
    }
    return runToolByName(toolDb, tool, args, context);
  };

  let browser;
  let stop = async () => {};
  const consoleErrors = [];
  const pageErrors = [];

  try {
    browser = await launchChromiumOrSkip(t);
    if (!browser) return;

    const serverRuntime = await startDashboardServer({ config, logger: { log: () => {} }, toolExecutor });
    const { port } = serverRuntime;
    stop = serverRuntime.stop;
    assert.ok(port > 0);

    const page = await browser.newPage();
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => {
      pageErrors.push(String(err?.stack || err));
    });

    await page.goto(`http://127.0.0.1:${port}/beta`, { waitUntil: "networkidle" });
    await page.waitForSelector(".beta-badge");

    await page.locator('.nav-item[data-view="home"]').click();
    await page.waitForSelector('[data-view-panel="home"]:not([hidden])');

    const taskRow = page.locator('[data-view-panel="home"] [data-surface-card="task"]').first();

    await taskRow.click();
    await waitForDrawerOpen(page);
    await waitForDrawerTitle(page, "Ask teacher");

    await page.keyboard.press("Escape");
    await waitForDrawerClosed(page);

    await taskRow.focus();
    await page.keyboard.press("Enter");
    await waitForDrawerOpen(page);
    await waitForDrawerTitle(page, "Ask teacher");
    await page.keyboard.press("Escape");
    await waitForDrawerClosed(page);

    await page.getByRole("button", { name: "Add follow-up" }).click();
    await waitForDrawerOpen(page);
    await waitForDrawerTitle(page, "Add a follow-up");
    await page.locator('input[name="title"]').fill("Email math teacher about missing quiz");
    await page.locator('input[name="remindAt"]').fill("2026-03-21T16:00");
    await page.locator('select[name="recurrence"]').selectOption("weekdays");
    await page.locator('textarea[name="message"]').fill("Follow up on missing quiz score.");
    await page.locator('form[data-form="task"] button[type="submit"]').click();
    await page.waitForSelector("text=Follow-up created.");

    const tasksAfterCreate = await readJson(`http://127.0.0.1:${port}/api/tasks?status=all`);
    const createdTask = tasksAfterCreate.rows.find((row) => row.title === "Email math teacher about missing quiz");
    assert.ok(createdTask);

    const createdTaskRow = page.locator('[data-view-panel="home"] [data-open-task-id]').filter({ hasText: "Email math teacher about missing quiz" }).first();
    await createdTaskRow.click();
    await waitForDrawerOpen(page);
    await waitForDrawerTitle(page, "Email math teacher about missing quiz");
    await page.locator('input[name="title"]').fill("Email math teacher about missing quiz - updated");
    await page.locator('input[name="remindAt"]').fill("2026-03-21T17:00");
    await page.locator('textarea[name="message"]').fill("Updated follow-up note.");
    await page.locator('form[data-form="task"] button[type="submit"]').click();
    await page.waitForSelector("text=Follow-up updated.");

    let tasksAfterEdit = await readJson(`http://127.0.0.1:${port}/api/tasks?status=all`);
    let editedTask = tasksAfterEdit.rows.find((row) => row.title === "Email math teacher about missing quiz - updated");
    assert.ok(editedTask);

    await page.getByRole("button", { name: "Mark done" }).click();
    await page.waitForSelector("text=Follow-up marked done.");
    await page.getByRole("button", { name: "Reopen" }).click();
    await page.waitForSelector("text=Follow-up reopened.");
    await page.getByRole("button", { name: "Delete" }).click();
    await page.waitForSelector("text=Follow-up deleted.");

    tasksAfterEdit = await readJson(`http://127.0.0.1:${port}/api/tasks?status=all`);
    editedTask = tasksAfterEdit.rows.find((row) => row.title === "Email math teacher about missing quiz - updated");
    assert.equal(editedTask, undefined);

    await page.locator('.nav-item[data-view="schoolwork"]').click();
    await page.waitForSelector('[data-view-panel="schoolwork"]:not([hidden])');

    const assignmentCard = page.locator('[data-view-panel="schoolwork"] [data-surface-card="assignment"]').first();
    await assignmentCard.click();
    await waitForDrawerOpen(page);
    await page.locator('label.outcome-option').filter({ has: page.locator('input[name="outcome"][value="submitted"]') }).click();
    await page.locator('form[data-form="assignment-status"] button[type="submit"]').click();
    await page.waitForSelector("text=Submitted partially applied");

    const submittedDetail = await readJson(`http://127.0.0.1:${port}/api/assignments/a1/detail`);
    assert.equal(submittedDetail.assignment.manualStatus, "Waiting on teacher");
    assert.equal(submittedDetail.notes.length, 0);

    assert.equal(consoleErrors.length, 0, consoleErrors.join("\n"));
    assert.equal(pageErrors.length, 0, pageErrors.join("\n"));
  } finally {
    if (browser) await browser.close();
    await stop().catch(() => {});
    closeDb();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("beta drawer preserves reminder drafts across rerendered view switches", async (t) => {
  const tempDir = makeDashboardTempDir("schoology-beta-ui-draft-");
  const config = makeDashboardConfig(tempDir);
  seedDashboardStateFile(config);
  const db = getDb(config);
  seedDashboardAssignments(db);
  seedDashboardTasks(db);

  const { port, stop } = await startDashboardServer({
    config,
    logger: { log: () => {} },
    toolExecutor: runToolByName,
  });
  let browser;
  const consoleErrors = [];
  const pageErrors = [];

  try {
    browser = await launchChromiumOrSkip(t);
    if (!browser) return;

    const page = await browser.newPage();
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => {
      pageErrors.push(String(err?.stack || err));
    });

    await page.goto(`http://127.0.0.1:${port}/beta`, { waitUntil: "networkidle" });
    await page.locator('.nav-item[data-view="schoolwork"]').click();
    await page.waitForSelector('[data-view-panel="schoolwork"]:not([hidden])');
    await page.locator('[data-view-panel="schoolwork"] [data-surface-card="assignment"]').first().click();
    await waitForDrawerOpen(page);
    await waitForDrawerTitle(page, "Homework 1");

    await ensureReminderSectionOpen(page);
    await page.locator('#drawerContent input[name="remindAt"]').fill("2026-03-24T16:45");
    await page.locator('#drawerContent select[name="recurrence"]').selectOption("weekdays");
    await page.locator('#drawerContent input[name="message"]').fill("Draft reminder should survive rerender");

    await page.evaluate(() => document.querySelector('.nav-item[data-view="admin"]')?.click());
    await page.waitForSelector('[data-view-panel="admin"]:not([hidden])');
    await waitForDrawerOpen(page);
    await waitForAssignmentDrawerReady(page);

    await page.evaluate(() => document.querySelector('.nav-item[data-view="schoolwork"]')?.click());
    await page.waitForSelector('[data-view-panel="schoolwork"]:not([hidden])');
    await waitForDrawerOpen(page);
    await ensureReminderSectionOpen(page);

    assert.equal(await page.locator('#drawerContent input[name="remindAt"]').inputValue(), "2026-03-24T16:45");
    assert.equal(await page.locator('#drawerContent select[name="recurrence"]').inputValue(), "weekdays");
    assert.equal(await page.locator('#drawerContent input[name="message"]').inputValue(), "Draft reminder should survive rerender");

    assert.equal(consoleErrors.length, 0, consoleErrors.join("\n"));
    assert.equal(pageErrors.length, 0, pageErrors.join("\n"));
  } finally {
    if (browser) await browser.close();
    await stop().catch(() => {});
    closeDb();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("beta assignment drawer ignores stale delayed detail responses and late detail results after close", async (t) => {
  const tempDir = makeDashboardTempDir("schoology-beta-ui-race-");
  const config = makeDashboardConfig(tempDir);
  seedDashboardStateFile(config);
  const db = getDb(config);
  seedDashboardAssignments(db);
  seedDashboardTasks(db);

  const { port, stop } = await startDashboardServer({
    config,
    logger: { log: () => {} },
    toolExecutor: runToolByName,
  });
  let browser;
  let activeDetailGate = null;
  const consoleErrors = [];
  const pageErrors = [];

  try {
    browser = await launchChromiumOrSkip(t);
    if (!browser) return;

    const page = await browser.newPage();
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => {
      pageErrors.push(String(err?.stack || err));
    });
    await page.route(`http://127.0.0.1:${port}/api/assignments/*/detail`, async (route, request) => {
      const match = request.url().match(/\/api\/assignments\/([^/]+)\/detail$/);
      const key = match ? decodeURIComponent(match[1]) : "";
      if (key === "a1" && activeDetailGate) {
        const gate = activeDetailGate;
        activeDetailGate = null;
        gate.markHit();
        await gate.wait;
        const response = await route.fetch();
        await route.fulfill({ response });
        gate.markServed();
        return;
      }
      await route.continue();
    });

    await page.goto(`http://127.0.0.1:${port}/beta`, { waitUntil: "networkidle" });
    await page.locator('.nav-item[data-view="schoolwork"]').click();
    await page.waitForSelector('[data-view-panel="schoolwork"]:not([hidden])');

    const assignmentOne = page.locator('[data-view-panel="schoolwork"] [data-open-assignment-key="a1"]').first();
    const assignmentTwo = page.locator('[data-view-panel="schoolwork"] [data-open-assignment-key="a2"]').first();

    const staleGate = createDelayGate();
    activeDetailGate = staleGate;
    await assignmentOne.click();
    await waitForDrawerOpen(page);
    await staleGate.hit;
    await page.evaluate(() => {
      document.querySelector('[data-view-panel="schoolwork"] [data-open-assignment-key="a2"]')?.click();
    });
    await waitForDrawerTitle(page, "Quiz 1");
    await waitForAssignmentDrawerReady(page);
    assert.equal(await page.locator('form[data-form="assignment-status"] input[name="key"]').inputValue(), "a2");

    staleGate.release();
    await staleGate.served;
    await waitForDrawerTitle(page, "Quiz 1");
    assert.equal(await page.locator('form[data-form="assignment-status"] input[name="key"]').inputValue(), "a2");

    await page.keyboard.press("Escape");
    await waitForDrawerClosed(page);

    const lateGate = createDelayGate();
    activeDetailGate = lateGate;
    await assignmentOne.click();
    await waitForDrawerOpen(page);
    await lateGate.hit;
    await page.keyboard.press("Escape");
    await waitForDrawerClosed(page);

    lateGate.release();
    await lateGate.served;
    await page.waitForTimeout(80);
    await waitForDrawerClosed(page);
    assert.equal(await page.locator("#detailDrawer").getAttribute("data-open"), "false");

    assert.equal(consoleErrors.length, 0, consoleErrors.join("\n"));
    assert.equal(pageErrors.length, 0, pageErrors.join("\n"));
  } finally {
    if (browser) await browser.close();
    await stop().catch(() => {});
    closeDb();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("beta drawer preserves drafts across timer-driven health polling", async (t) => {
  const tempDir = makeDashboardTempDir("schoology-beta-ui-poll-");
  const config = makeDashboardConfig(tempDir);
  seedDashboardStateFile(config);
  const db = getDb(config);
  seedDashboardAssignments(db);
  seedDashboardTasks(db);

  const { port, stop } = await startDashboardServer({
    config,
    logger: { log: () => {} },
    toolExecutor: runToolByName,
  });
  let browser;
  const consoleErrors = [];
  const pageErrors = [];

  try {
    browser = await launchChromiumOrSkip(t);
    if (!browser) return;

    const page = await browser.newPage();
    await page.addInitScript(() => {
      window.__betaHealthFetchCompleteCount = 0;
      window.__betaHealthPollTickCount = 0;

      const originalFetch = window.fetch.bind(window);
      window.fetch = async (...args) => {
        const input = args[0];
        const url = typeof input === "string" ? input : input?.url;
        const isHealth = typeof url === "string" && url.includes("/api/health");
        try {
          return await originalFetch(...args);
        } finally {
          if (isHealth) {
            window.__betaHealthFetchCompleteCount += 1;
          }
        }
      };

      const originalSetInterval = window.setInterval.bind(window);
      const originalSetTimeout = window.setTimeout.bind(window);
      window.setInterval = (callback, delay, ...args) => {
        if (delay === 30000) {
          return originalSetTimeout((...callbackArgs) => {
            window.__betaHealthPollTickCount += 1;
            return callback(...callbackArgs);
          }, 1000, ...args);
        }
        return originalSetInterval(callback, delay, ...args);
      };
    });
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => {
      pageErrors.push(String(err?.stack || err));
    });

    await page.goto(`http://127.0.0.1:${port}/beta`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".beta-badge");
    await page.locator('.nav-item[data-view="schoolwork"]').click();
    await page.waitForSelector('[data-view-panel="schoolwork"]:not([hidden])');
    await page.evaluate(() => {
      document.querySelector('[data-view-panel="schoolwork"] [data-open-assignment-key="a1"]')?.click();
    });
    await waitForDrawerOpen(page);
    await waitForDrawerTitle(page, "Homework 1");

    await ensureReminderSectionOpen(page);
    await page.locator('#drawerContent input[name="remindAt"]').fill("2026-03-25T15:30");
    await page.locator('#drawerContent select[name="recurrence"]').selectOption("weekly");
    await page.locator('#drawerContent input[name="message"]').fill("Live health polling should not wipe this draft");

    const baselineHealthFetches = await page.evaluate(() => window.__betaHealthFetchCompleteCount || 0);
    await page.waitForFunction(
      (baseline) =>
        (window.__betaHealthPollTickCount || 0) >= 1 && (window.__betaHealthFetchCompleteCount || 0) > baseline,
      baselineHealthFetches
    );
    await page.waitForTimeout(80);
    await waitForDrawerOpen(page);
    await ensureReminderSectionOpen(page);

    assert.equal(await page.locator('#drawerContent input[name="remindAt"]').inputValue(), "2026-03-25T15:30");
    assert.equal(await page.locator('#drawerContent select[name="recurrence"]').inputValue(), "weekly");
    assert.equal(await page.locator('#drawerContent input[name="message"]').inputValue(), "Live health polling should not wipe this draft");

    assert.equal(consoleErrors.length, 0, consoleErrors.join("\n"));
    assert.equal(pageErrors.length, 0, pageErrors.join("\n"));
  } finally {
    if (browser) await browser.close();
    await stop().catch(() => {});
    closeDb();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
