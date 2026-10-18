// Deterministic source driver. Chrome owns its session in a separate profile;
// no password, cookie, storageState export, listener, model or reminder path.
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { projectCurrentGradebook } from "./current_gradebook.js";
import { getSchoologyBrowserLaunchOptions } from "./schoology_browser.js";

export class SourceSessionRequired extends Error {}

export async function readOriginalProfileSource(config, { interactive = false, onAuthRequired = () => {} } = {}) {
  const expectedProfile = path.join(path.dirname(config.databasePath), "schoology-app-profile");
  if (!path.isAbsolute(config.databasePath) || path.resolve(config.browserProfileDirectory || "") !== expectedProfile) throw Error("Separate app-owned browser profile required");
  fs.mkdirSync(expectedProfile, { recursive: true });
  const lockPath = path.join(path.dirname(config.databasePath), "source-profile.lock");
  const lock = fs.openSync(lockPath, "wx");
  let context;
  try {
    context = await chromium.launchPersistentContext(expectedProfile, { ...getSchoologyBrowserLaunchOptions("chrome"), headless: !interactive, acceptDownloads: false });
    const page = context.pages()[0] || await context.newPage();
    await page.goto("https://bcps.schoology.com/grades/grades", { waitUntil: "domcontentloaded", timeout: 30000 });
    let notified = false;
    const deadline = Date.now() + (interactive ? 30 * 60 * 1000 : 15000);
    while (!(new URL(page.url()).origin === "https://bcps.schoology.com" && new URL(page.url()).pathname === "/grades/grades" && await page.locator("div.gradebook-course").count())) {
      if (!interactive || Date.now() >= deadline) throw new SourceSessionRequired("Sign in to Schoology in the app-owned Chrome profile");
      if (!notified) { onAuthRequired(); notified = true; }
      await page.waitForTimeout(750);
      const current = new URL(page.url());
      if (current.origin === "https://bcps.schoology.com" && current.pathname === "/home") await page.goto("https://bcps.schoology.com/grades/grades", { waitUntil: "domcontentloaded" });
    }
    const courses = await page.locator("div.gradebook-course").all();
    for (const course of courses) {
      if (!(await course.locator(".gradebook-course-grades").isVisible())) await course.locator(".gradebook-course-title").click();
    }
    await page.locator("button.Z_KgC").click();
    const expectedScope = { principalId: config.principalId, studentId: config.studentProfileId, currentTermId: config.currentTermId, currentTermLabel: config.currentTerm };
    const expression = `(${projectCurrentGradebook.toString()})({document,origin:location.origin,pathname:location.pathname,observedAt:new Date().toISOString(),expectedScope:${JSON.stringify(expectedScope)}})`;
    return await page.evaluate(expression);
  } finally {
    if (context) await context.close();
    fs.closeSync(lock); fs.unlinkSync(lockPath);
  }
}
