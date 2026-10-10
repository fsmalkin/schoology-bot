import { chromium } from "playwright";
import { getSchoologyBrowserLaunchOptions } from "../src/schoology_browser.js";

export async function launchChromiumOrSkip(t) {
  const channel = String(process.env.SCHOLOGY_BROWSER_CHANNEL ?? "").trim();
  try {
    return await chromium.launch(getSchoologyBrowserLaunchOptions(channel));
  } catch (err) {
    const message = String(err?.message || err);
    if (!channel && (message.includes("Executable doesn't exist") || message.includes("browserType.launch"))) {
      t.skip("Playwright Chromium is not installed in this environment.");
      return null;
    }
    throw err;
  }
}
