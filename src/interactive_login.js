import "dotenv/config";
import { chromium } from "playwright";

let browser;
try {
  browser = await chromium.launch({ headless: false });
} catch (err) {
  console.error("Failed to launch a headed browser.");
  console.error("If you are running inside Docker, run this command on your host instead:");
  console.error("  npm run login:interactive");
  console.error("Then re-run the containers so they pick up data/storage.json.");
  console.error("Error:", err?.message || err);
  process.exit(1);
}

const context = await browser.newContext();
const page = await context.newPage();
page.setDefaultTimeout(30000);

await page.goto("https://bcps.schoology.com/parent/grades_attendance/grades", { waitUntil: "domcontentloaded" });

console.log("Current URL:", page.url());
console.log("Log in manually, then press Enter here to save session.");

process.stdin.setEncoding("utf8");
process.stdin.once("data", async () => {
  try {
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await context.storageState({ path: "data/storage.json" });
    console.log("Saved storage state to data/storage.json");
  } catch (err) {
    console.error("Failed to save storage state:", err.message || err);
  } finally {
    await browser.close();
    process.exit(0);
  }
});
