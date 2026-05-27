import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTelegramTargetKey,
  buildTelegramThreadOptions,
  formatTelegramTarget,
  normalizeTelegramThreadId,
} from "../src/telegram_threading.js";

test("normalizes Telegram thread ids conservatively", () => {
  assert.equal(normalizeTelegramThreadId(" 123 "), "123");
  assert.equal(normalizeTelegramThreadId(456), "456");
  assert.equal(normalizeTelegramThreadId(""), "");
  assert.equal(normalizeTelegramThreadId("abc"), "");
  assert.equal(normalizeTelegramThreadId("0"), "");
  assert.equal(normalizeTelegramThreadId("-1"), "");
});

test("builds thread-aware Telegram options without mutating base options", () => {
  const base = { disable_web_page_preview: true };
  const options = buildTelegramThreadOptions("42", base);

  assert.deepEqual(base, { disable_web_page_preview: true });
  assert.deepEqual(options, {
    disable_web_page_preview: true,
    message_thread_id: 42,
  });
  assert.deepEqual(buildTelegramThreadOptions("", base), base);
});

test("keys managed sessions by chat and thread", () => {
  assert.equal(buildTelegramTargetKey("-1001", ""), "-1001");
  assert.equal(buildTelegramTargetKey("-1001", "77"), "-1001:thread:77");
  assert.equal(formatTelegramTarget("-1001", "77"), "-1001 thread 77");
});
