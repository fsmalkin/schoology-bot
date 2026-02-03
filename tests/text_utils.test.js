import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeRepeatedText } from "../src/text_utils.js";

test("sanitizeRepeatedText collapses repeated lines", () => {
  const input = "Updating now...\nUpdating now...\nUpdating now...\nDone";
  const output = sanitizeRepeatedText(input);
  assert.equal(output, "Updating now...\nDone");
});

test("sanitizeRepeatedText collapses repeated phrases", () => {
  const input = "Updating now. Updating now. Updating now.";
  const output = sanitizeRepeatedText(input);
  assert.equal(output, "Updating now.");
});
