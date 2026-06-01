import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium } from "playwright";
import { closeDb, getDb } from "../src/db.js";
import {
  makeDashboardConfig,
  makeDashboardTempDir,
  seedDashboardStateFile,
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

test("beta schoolwork groups future assignments under Coming up", async (t) => {
  const tempDir = makeDashboardTempDir("schoology-dashboard-due-ui-");
  const config = makeDashboardConfig(tempDir);
  seedDashboardStateFile(config);
  const db = getDb(config);
  db.prepare(
    `
    INSERT INTO assignments (
      key, course, title, due_date, status, score, url, raw_text,
      first_seen_at, last_seen_at, last_missing_at, resolved_at, is_missing, manual_status, auto_ignored
    )
    VALUES
      ('past', 'Science: Sec 1', 'Past Lab', '5/31/26 11:59pm', 'Missing', '', '', '', '2026-06-01T00:00:00Z', '2026-06-01T00:00:00Z', '2026-06-01T00:00:00Z', NULL, 1, NULL, 0),
      ('future', 'Language Arts: Sec 1', 'Future Essay', '6/02/26 11:59pm', 'Missing', '', '', '', '2026-06-01T00:00:00Z', '2026-06-01T00:00:00Z', '2026-06-01T00:00:00Z', NULL, 1, NULL, 0)
  `
  ).run();

  let browser;
  let stop = async () => {};
  try {
    browser = await launchChromiumOrSkip(t);
    if (!browser) return;

    const serverRuntime = await startDashboardServer({ config, logger: { log: () => {} } });
    stop = serverRuntime.stop;
    const page = await browser.newPage();
    await page.goto(`${serverRuntime.baseUrl}/beta`, { waitUntil: "networkidle" });
    await page.locator('.nav-item[data-view="schoolwork"]').click();
    await page.waitForSelector('[data-view-panel="schoolwork"]:not([hidden])');

    const schoolwork = page.locator('[data-view-panel="schoolwork"]:not([hidden])');
    const attention = schoolwork.locator('.schoolwork-group[data-lane="actionable"]');
    const upcoming = schoolwork.locator('.schoolwork-group[data-lane="upcoming"]');
    assert.equal(await attention.count(), 1);
    assert.equal(await upcoming.count(), 1);

    const attentionText = await attention.textContent();
    const upcomingText = await upcoming.textContent();
    assert.match(attentionText || "", /Past Lab/);
    assert.doesNotMatch(attentionText || "", /Future Essay/);
    assert.match(upcomingText || "", /Coming up/);
    assert.match(upcomingText || "", /Future Essay/);
    assert.doesNotMatch(upcomingText || "", /Overdue/);
  } finally {
    if (browser) await browser.close();
    await stop().catch(() => {});
    closeDb();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
