import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isRepetitiveOutput,
  sanitizeRepeatedText,
  isToolingLoop,
  normalizeAscii,
  deriveSchoologyAssignmentTitle,
} from "../src/text_utils.js";

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

test("isToolingLoop detects tool babble", () => {
  const input =
    "Ok. Let's call. Ok. I must call function with correct JSON. Ok. Call. Ok. I'm stuck in loop.";
  assert.equal(isToolingLoop(input), true);
});

test("normalizeAscii converts smart punctuation", () => {
  const input = "Don\u2019t wait\u2014it\u2019s due\u2026";
  const output = normalizeAscii(input);
  assert.equal(output, "Don't wait-it's due...");
});

test("deriveSchoologyAssignmentTitle falls back to raw Schoology row text", () => {
  const title = deriveSchoologyAssignmentTitle({
    rawText:
      "L4 Text Features Ice Cream and Cell Phones ArticlesNote: This material is not available within Schoology Due 2/13/260MissingComment: Missing, present during instruction.Offered/Received accommodation",
  });
  assert.equal(title, "L4 Text Features Ice Cream and Cell Phones Articles");
});
