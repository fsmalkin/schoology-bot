import test from "node:test";
import assert from "node:assert/strict";
import { createGithubIssue, openBugReport } from "../src/bugs.js";

const config = {
  github: {
    repo: "",
    token: "",
    labels: [],
  },
  paths: {
    bugLogPath: "",
  },
};

test("createGithubIssue rejects empty body", async () => {
  const result = await createGithubIssue(config, { title: "Test bug", body: "" });
  assert.equal(result.ok, false);
  assert.match(result.error, /body is required/i);
});

test("openBugReport rejects empty body", async () => {
  const result = await openBugReport(config, { title: "Test bug", body: "" });
  assert.equal(result.logged, false);
  assert.equal(result.issue.ok, false);
  assert.match(result.issue.error, /body is required/i);
});
