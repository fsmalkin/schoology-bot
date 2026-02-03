import "dotenv/config";
import { chromium } from "playwright";

const gradesUrl = process.env.SCHOLOGY_GRADES_URL || "https://bcps.schoology.com/grades/grades";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ storageState: "data/storage.json" });
const page = await context.newPage();
page.setDefaultTimeout(30000);

const matches = [];

page.on("response", async (response) => {
  const url = response.url();
  const lower = url.toLowerCase();
  if (!/(grade|gradebook|assignment|missing|course|section|enroll|api)/i.test(lower)) return;

  const ct = response.headers()["content-type"] || "";
  const status = response.status();
  let size = 0;
  try {
    const buffer = await response.body();
    size = buffer.length;
    if (size > 800000) {
      matches.push({ url, status, contentType: ct, size });
      return;
    }
    const text = buffer.toString("utf8");
    const sample = text.slice(0, 200);
    const entry = { url, status, contentType: ct, size, sample };
    if (text.trim().startsWith("{") || text.trim().startsWith("[")) {
      try {
        const data = JSON.parse(text);
        entry.keys = Array.isArray(data) ? ["array"] : Object.keys(data || {}).slice(0, 20);
      } catch {
        // ignore
      }
    }
    matches.push(entry);
  } catch {
    matches.push({ url, status, contentType: ct, size: null });
  }
});

await page.goto(gradesUrl, { waitUntil: "domcontentloaded" });
await page.waitForLoadState("networkidle");

console.log(JSON.stringify(matches, null, 2));

await browser.close();
