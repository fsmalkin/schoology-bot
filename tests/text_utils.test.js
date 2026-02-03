import { test } from "node:test";
import assert from "node:assert/strict";
import { isRepetitiveOutput, sanitizeRepeatedText } from "../src/text_utils.js";

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

test("isRepetitiveOutput detects repeated lines", () => {
  const input = "Updating now...\nUpdating now...\nUpdating now...\nUpdating now...";
  assert.equal(isRepetitiveOutput(input), true);
});

test("isRepetitiveOutput allows normal text", () => {
  const input = "All updates applied. Let me know if you need anything else.";
  assert.equal(isRepetitiveOutput(input), false);
});
