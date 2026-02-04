import test from "node:test";
import assert from "node:assert/strict";
import { renderTelegramHtml, renderTelegramPlain } from "../src/telegram_format.js";

test("renderTelegramHtml converts HTML tags and entities", () => {
  const input = "<b>1) Title</b>\n&bull; Item one\n&bull; Item two";
  const output = renderTelegramHtml(input);
  assert.match(output, /<b>1\) Title<\/b>/);
  assert.match(output, /- Item one/);
  assert.match(output, /- Item two/);
  assert.ok(!output.includes("&bull;"));
});

test("renderTelegramHtml handles inline code and italics", () => {
  const input = "Use <code>A</code> and <i>italic</i>.";
  const output = renderTelegramHtml(input);
  assert.match(output, /<code>A<\/code>/);
  assert.match(output, /<i>italic<\/i>/);
});

test("renderTelegramPlain strips tags and entities", () => {
  const input = "<b>Title</b>\n&bull; Item one\n`code` and *italic*";
  const output = renderTelegramPlain(input);
  assert.ok(!output.includes("<b>"));
  assert.ok(!output.includes("&bull;"));
  assert.ok(output.includes("Title"));
  assert.ok(output.includes("Item one"));
  assert.ok(output.includes("code"));
  assert.ok(output.includes("italic"));
});
