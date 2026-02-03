import test from "node:test";
import assert from "node:assert/strict";
import { batchMessages } from "../src/telegram_queue.js";

test("batchMessages joins within size", () => {
  const input = ["one", "two", "three"];
  const result = batchMessages(input, 100);
  assert.equal(result, "one\ntwo\nthree");
});

test("batchMessages trims oldest when exceeding size", () => {
  const input = ["first", "second", "third", "fourth"];
  const result = batchMessages(input, 12);
  assert.equal(result, "third\nfourth");
});
