import "dotenv/config";
import fs from "fs";
import path from "path";
import { chromium } from "playwright";

const gradesUrl = process.env.SCHOLOGY_GRADES_URL || "https://bcps.schoology.com/grades/grades";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ storageState: "data/storage.json" });
const page = await context.newPage();
page.setDefaultTimeout(30000);

await page.goto(gradesUrl, { waitUntil: "domcontentloaded" });
await page.waitForLoadState("networkidle");

const html = await page.content();
fs.writeFileSync(path.join("data", "grades.html"), html, "utf8");

const summary = await page.evaluate(() => {
  const text = document.body ? document.body.innerText || "" : "";
  return {
    title: document.title,
    url: location.href,
    hasMissingWord: /missing/i.test(text),
    sampleText: text.replace(/\s+/g, " ").slice(0, 500),
  };
});

console.log(JSON.stringify(summary, null, 2));

await browser.close();
