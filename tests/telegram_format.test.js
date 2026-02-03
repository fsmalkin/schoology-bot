import test from "node:test";
import assert from "node:assert/strict";
import { renderTelegramHtml } from "../src/telegram_format.js";

test("renderTelegramHtml converts bold and headings", () => {
  const input = "## Title\nHere is **bold** text.";
  const output = renderTelegramHtml(input);
  assert.match(output, /<b>Title<\/b>/);
  assert.match(output, /<b>bold<\/b>/);
});

test("renderTelegramHtml escapes html and supports inline code", () => {
  const input = "Use `npm test` if a < b.";
  const output = renderTelegramHtml(input);
  assert.match(output, /<code>npm test<\/code>/);
  assert.match(output, /a &lt; b/);
});

test("renderTelegramHtml converts bullets and italics", () => {
  const input = "- *One* item\n- Two";
  const output = renderTelegramHtml(input);
  assert.match(output, /- <i>One<\/i> item/);
  assert.match(output, /- Two/);
});

test("renderTelegramHtml handles markdown list lines with emphasis", () => {
  const input =
    "Missing assignments:\n- Algebra: *U5 Compound Interest/Intervals* - due 1/23/26\n- Latin: *January 30th* - due by 2/14";
  const output = renderTelegramHtml(input);
  assert.ok(
    output.includes("- Algebra: <i>U5 Compound Interest/Intervals</i> - due 1/23/26")
  );
  assert.ok(output.includes("- Latin: <i>January 30th</i> - due by 2/14"));
});

test("renderTelegramHtml supports code fences", () => {
  const input = "```\nline 1 < line 2\n```";
  const output = renderTelegramHtml(input);
  assert.match(output, /<pre><code>[\s\S]*line 1 &lt; line 2/);
});
