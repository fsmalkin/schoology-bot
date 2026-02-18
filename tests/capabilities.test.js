import test from "node:test";
import assert from "node:assert/strict";
import { buildCapabilitySummary, getCapabilityRegistry } from "../src/capabilities.js";

test("capability registry filters to allowed tools", () => {
  const registry = getCapabilityRegistry({
    allowedTools: ["list_assignments", "schedule_reminder"],
    config: { github: { repo: "", token: "" } },
  });
  const names = registry.tools.map((tool) => tool.name);
  assert.deepEqual(names, ["list_assignments", "schedule_reminder"]);
  assert.equal(registry.integrations.githubIssueCreate, false);
});

test("capability summary includes runtime limits and fallback hints", () => {
  const summary = buildCapabilitySummary({
    allowedTools: ["schedule_reminder", "open_bug_report"],
    config: { github: { repo: "fsmalkin/schoology-bot", token: "token" } },
  });
  assert.match(summary, /one-time reminders only/i);
  assert.match(summary, /Recurring reminders are not supported/i);
  assert.match(summary, /GitHub issue creation is configured/i);
});
