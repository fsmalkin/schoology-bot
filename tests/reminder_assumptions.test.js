import test from "node:test";
import assert from "node:assert/strict";
import { applyReminderAssumptions } from "../src/reminder_assumptions.js";

test("explicit recurring ask defaults cadence to weekdays and sets fallback time", () => {
  const result = applyReminderAssumptions({
    args: { title: "Check Schoology", remindAt: null, recurrence: null },
    userText: "Set a recurring reminder to check Schoology.",
    timeZone: "America/New_York",
    now: new Date("2026-02-23T15:00:00Z"),
    allowCreateDefaults: true,
  });

  assert.equal(result.error, null);
  assert.equal(result.args.recurrence, "weekdays");
  assert.ok(result.args.remindAt);
  const local = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(result.args.remindAt));
  assert.equal(local, "21:00");
});

test("follow-up cue defaults to 4:30 PM ET when recurring time is missing", () => {
  const result = applyReminderAssumptions({
    args: { title: "Follow up on algebra", recurrence: "daily" },
    userText: "Follow up after school every day",
    timeZone: "America/New_York",
    now: new Date("2026-02-23T15:00:00Z"),
    allowCreateDefaults: true,
  });

  assert.equal(result.error, null);
  assert.equal(result.args.recurrence, "daily");
  const local = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(result.args.remindAt));
  assert.equal(local, "16:30");
});

test("unsupported cadence falls back to weekly with warning", () => {
  const result = applyReminderAssumptions({
    args: { title: "Review grades", recurrence: "monthly" },
    userText: "Create a monthly reminder for grades.",
    timeZone: "America/New_York",
    now: new Date("2026-02-23T15:00:00Z"),
    allowCreateDefaults: true,
  });

  assert.equal(result.error, null);
  assert.equal(result.args.recurrence, "weekly");
  assert.ok(Array.isArray(result.warnings));
  assert.equal(result.warnings.length > 0, true);
});

test("unsupported cadence still emits warning when recurrence is pre-normalized to weekly", () => {
  const result = applyReminderAssumptions({
    args: { title: "Review grades", recurrence: "weekly" },
    userText: "Create a monthly reminder for grades.",
    timeZone: "America/New_York",
    now: new Date("2026-02-23T15:00:00Z"),
    allowCreateDefaults: true,
  });

  assert.equal(result.error, null);
  assert.equal(result.args.recurrence, "weekly");
  assert.ok(Array.isArray(result.warnings));
  assert.equal(
    result.warnings.some((warning) => String(warning || "").toLowerCase().includes("unsupported cadence")),
    true
  );
});

test("no frequency cue does not force recurring defaults", () => {
  const result = applyReminderAssumptions({
    args: { title: "Check backpack" },
    userText: "Remind me to check backpack.",
    timeZone: "America/New_York",
    now: new Date("2026-02-23T15:00:00Z"),
    allowCreateDefaults: true,
  });

  assert.equal(result.error, null);
  assert.equal(result.args.recurrence, undefined);
  assert.equal(result.args.remindAt, undefined);
});
