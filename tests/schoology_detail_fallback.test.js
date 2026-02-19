import test from "node:test";
import assert from "node:assert/strict";
import {
  applyDetailFallback,
  classifyAssignmentDetailText,
  needsAssignmentDetailFallback,
} from "../src/schoology.js";

test("classifyAssignmentDetailText detects submitted-awaiting-grade", () => {
  const parsed = classifyAssignmentDetailText(
    "This student has made a submission that has not been graded."
  );
  assert.ok(parsed);
  assert.equal(parsed.status, "Submitted, awaiting grade");
  assert.equal(parsed.isMissing, true);
});

test("applyDetailFallback resolves ambiguous rows with cap", async () => {
  const assignments = [
    {
      course: "Latin",
      title: "Essay",
      status: "Missing",
      isMissing: true,
      url: "https://example.com/1",
      rawText: "Missing",
      needsDetailFallback: true,
    },
    {
      course: "Science",
      title: "Lab",
      status: "Missing",
      isMissing: true,
      url: "https://example.com/2",
      rawText: "Missing",
      needsDetailFallback: true,
    },
    {
      course: "Math",
      title: "Quiz",
      status: "Missing",
      isMissing: true,
      url: "https://example.com/3",
      rawText: "Missing",
      needsDetailFallback: true,
    },
  ];

  let calls = 0;
  const result = await applyDetailFallback(
    assignments,
    async (_item) => {
      calls += 1;
      return "Assignment submitted and awaiting grade.";
    },
    { enabled: true, max: 1 }
  );

  assert.equal(result.candidates, 3);
  assert.equal(result.attempted, 1);
  assert.equal(result.capped, 2);
  assert.equal(result.resolved, 1);
  assert.equal(calls, 1);
  assert.equal(assignments[0].status, "Submitted, awaiting grade");
  assert.equal(assignments[0].detailStatusSource, "detail");
  assert.equal(assignments[1].status, "Missing");
});

test("needsAssignmentDetailFallback requires missing + url + flag", () => {
  assert.equal(
    needsAssignmentDetailFallback({
      isMissing: true,
      url: "https://example.com/a",
      needsDetailFallback: true,
    }),
    true
  );
  assert.equal(needsAssignmentDetailFallback({ isMissing: false, url: "x", needsDetailFallback: true }), false);
  assert.equal(needsAssignmentDetailFallback({ isMissing: true, needsDetailFallback: true }), false);
  assert.equal(needsAssignmentDetailFallback({ isMissing: true, url: "x" }), false);
});
