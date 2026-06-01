import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifySchoologyDueDate,
  formatDateYmd,
  parseSchoologyDate,
  parseReminderTime,
  formatDateTime,
} from "../src/time.js";

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

test("classifySchoologyDueDate uses configured local date instead of UTC date", () => {
  const now = new Date("2026-06-02T03:30:00Z"); // Jun 1, 11:30 PM in New York

  assert.equal(
    classifySchoologyDueDate("6/01/26 11:59pm", "America/New_York", now).dueCategory,
    "today"
  );
  assert.equal(
    classifySchoologyDueDate("6/02/26 11:59pm", "America/New_York", now).dueCategory,
    "upcoming"
  );
  assert.equal(
    classifySchoologyDueDate("5/31/26 11:59pm", "America/New_York", now).dueCategory,
    "overdue"
  );
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

test("parseReminderTime treats '12 PM' as noon in configured timezone", () => {
  // When server is UTC but timezone is Eastern, "12 PM" must resolve to noon Eastern
  // (16:00 UTC), not noon UTC (which would display as 8 AM Eastern).
  const now = new Date("2026-03-20T14:00:00Z"); // 10 AM EDT
  const result = parseReminderTime("12 PM", "America/New_York", now);
  assert.equal(result.ok, true);
  const label = formatDateTime(result.date, "America/New_York");
  assert.equal(label, "2026-03-20 12:00");
  assert.equal(result.date.toISOString(), "2026-03-20T16:00:00.000Z");
});

test("parseReminderTime treats datetime-local string in configured timezone", () => {
  // A datetime-local input submits "2026-03-20T12:00" with no timezone offset.
  // It must be interpreted as noon America/New_York, not server local time.
  const result = parseReminderTime("2026-03-20T12:00", "America/New_York");
  assert.equal(result.ok, true);
  const label = formatDateTime(result.date, "America/New_York");
  assert.equal(label, "2026-03-20 12:00");
  // UTC should be 4 hours ahead of EDT (UTC-4)
  assert.equal(result.date.toISOString(), "2026-03-20T16:00:00.000Z");
});
