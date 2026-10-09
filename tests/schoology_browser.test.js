import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { getSchoologyBrowserLaunchOptions } from "../src/schoology_browser.js";

test("Schoology browser keeps the default headless Chromium selection", () => {
  for (const channel of [undefined, null, "", "  "]) {
    assert.deepEqual(getSchoologyBrowserLaunchOptions(channel), { headless: true });
  }
});

test("Schoology browser passes an explicit channel to Playwright", () => {
  assert.deepEqual(getSchoologyBrowserLaunchOptions(" chrome "), {
    headless: true,
    channel: "chrome",
  });
  assert.deepEqual(getSchoologyBrowserLaunchOptions("msedge"), {
    headless: true,
    channel: "msedge",
  });
});

test("Schoology browser config captures the nonsecret channel setting", async () => {
  const prior = process.env.SCHOLOGY_BROWSER_CHANNEL;
  try {
    process.env.SCHOLOGY_BROWSER_CHANNEL = ' "chrome" ';
    const { getConfig } = await import("../src/config.js?browser-channel=explicit");
    assert.equal(getConfig().schoology.browserChannel, "chrome");

    delete process.env.SCHOLOGY_BROWSER_CHANNEL;
    const unset = await import("../src/config.js?browser-channel=unset");
    assert.equal(unset.getConfig().schoology.browserChannel, "");
  } finally {
    if (prior === undefined) delete process.env.SCHOLOGY_BROWSER_CHANNEL;
    else process.env.SCHOLOGY_BROWSER_CHANNEL = prior;
  }
});

test("Playwright rejects an unsupported selected channel before browser startup", async () => {
  await assert.rejects(
    chromium.launch(getSchoologyBrowserLaunchOptions("schoology-unsupported-test")),
    /Unsupported chromium channel/,
  );
});
