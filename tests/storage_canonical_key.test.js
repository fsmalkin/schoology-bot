import test from "node:test";
import assert from "node:assert/strict";
import { extractAssignmentId, makeAssignmentKey } from "../src/storage.js";

test("extractAssignmentId finds Schoology assignment id from full URL", () => {
  const id = extractAssignmentId("https://bcps.schoology.com/assignment/8267055411");
  assert.equal(id, "8267055411");
});

test("makeAssignmentKey uses canonical assignment:<id> when id is present", () => {
  const key = makeAssignmentKey({
    url: "https://bcps.schoology.com/assignment/8267055411",
    title: "Topic 3 Show What You Know",
    course: "Latin",
  });
  assert.equal(key, "assignment:8267055411");
});

test("makeAssignmentKey falls back to hash when assignment id is unavailable", () => {
  const key = makeAssignmentKey({
    url: "https://bcps.schoology.com/course/12345/materials",
    title: "Unit Reflection",
    course: "ELA",
    dueDate: "2026-03-01",
  });
  assert.equal(key.startsWith("assignment:"), false);
  assert.equal(key.length, 40);
});
