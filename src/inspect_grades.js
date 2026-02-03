import "dotenv/config";
import { chromium } from "playwright";

const gradesUrl = process.env.SCHOLOGY_GRADES_URL || "https://bcps.schoology.com/grades/grades";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ storageState: "data/storage.json" });
const page = await context.newPage();
page.setDefaultTimeout(30000);

await page.goto(gradesUrl, { waitUntil: "domcontentloaded" });
await page.waitForLoadState("networkidle");

const data = await page.evaluate(() => {
  const anchors = Array.from(document.querySelectorAll("a[href]"));
  const hrefs = anchors.map((a) => a.href);
  const courseLinks = hrefs.filter((h) => /\/course\//i.test(h) || /\/sections\//i.test(h));
  const gradeLinks = hrefs.filter((h) => /grades/i.test(h));
  const classMatches = Array.from(
    document.querySelectorAll("[class*='grade'], [class*='Grades'], [class*='course'], [class*='Course']")
  )
    .slice(0, 80)
    .map((el) => ({
      tag: el.tagName,
      className: el.className,
      id: el.id || null,
      text: (el.textContent || "").trim().slice(0, 80),
    }));
  const dataAttrs = Array.from(
    document.querySelectorAll(
      "[data-section-id],[data-course-id],[data-course],[data-section],[data-gradebook],[data-grade-id]"
    )
  )
    .slice(0, 80)
    .map((el) => ({
      tag: el.tagName,
      className: el.className,
      id: el.id || null,
      dataset: { ...el.dataset },
      text: (el.textContent || "").trim().slice(0, 80),
    }));
  const globals = {
    hasDrupal: typeof window.Drupal !== "undefined",
    hasDrupalSettings: typeof window.drupalSettings !== "undefined",
    drupalSettingsKeys:
      typeof window.drupalSettings !== "undefined" ? Object.keys(window.drupalSettings).slice(0, 30) : [],
  };
  return {
    title: document.title,
    url: location.href,
    totalLinks: hrefs.length,
    courseLinks: Array.from(new Set(courseLinks)).slice(0, 30),
    gradeLinks: Array.from(new Set(gradeLinks)).slice(0, 30),
    classMatches,
    dataAttrs,
    globals,
  };
});

console.log(JSON.stringify(data, null, 2));

await browser.close();
