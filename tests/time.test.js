import { test } from "node:test";
import assert from "node:assert/strict";
import { formatDateYmd, parseSchoologyDate } from "../src/time.js";

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
