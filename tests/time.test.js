import { test } from "node:test";
import assert from "node:assert/strict";
import { formatDateYmd, parseSchoologyDate, parseReminderTime, formatDateTime } from "../src/time.js";

test("parseSchoologyDate handles date with time", () => {
  const parsed = parseSchoologyDate("1/23/26 11:59pm", "America/New_York");
  assert.ok(parsed);
  const ymd = formatDateYmd(parsed, "America/New_York");
  assert.equal(ymd, "2026-01-23");
});

test("parseSchoologyDate handles date without time", () => {
  const parsed = parseSchoologyDate("1/23/26", "America/New_York");
  assert.ok(parsed);
  const ymd = formatDateYmd(parsed, "America/New_York");
  assert.equal(ymd, "2026-01-23");
});

test("parseReminderTime handles natural language", () => {
  const now = new Date("2026-02-05T10:00:00-05:00");
  const result = parseReminderTime("tomorrow at 4pm", "America/New_York", now);
  assert.equal(result.ok, true);
  const label = formatDateTime(result.date, "America/New_York");
  assert.equal(label.startsWith("2026-02-06"), true);
});

test("parseReminderTime handles shorthand digits", () => {
  const now = new Date("2026-02-05T10:00:00-05:00");
  const result = parseReminderTime("345", "America/New_York", now);
  assert.equal(result.ok, true);
  const label = formatDateTime(result.date, "America/New_York");
  assert.equal(label, "2026-02-05 15:45");
});
