import { test } from "node:test";
import assert from "node:assert/strict";
import { STATUS_CODE_MAP, normalizeManualStatus } from "../src/statuses.js";

test("normalizeManualStatus maps codes", () => {
  assert.equal(normalizeManualStatus("A"), STATUS_CODE_MAP.A);
  assert.equal(normalizeManualStatus("b"), STATUS_CODE_MAP.B);
  assert.equal(normalizeManualStatus("C"), STATUS_CODE_MAP.C);
  assert.equal(normalizeManualStatus("d"), STATUS_CODE_MAP.D);
});

test("normalizeManualStatus returns custom text", () => {
  assert.equal(normalizeManualStatus("Waiting on counselor"), "Waiting on counselor");
});
