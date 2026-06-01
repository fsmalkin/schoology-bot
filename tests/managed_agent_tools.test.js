import test from "node:test";
import assert from "node:assert/strict";
import { buildManagedAgentCustomToolDefinitions } from "../src/managed_agent_tools.js";
import { TOOL_NAMES } from "../src/tool_runner.js";

test("managed agent custom tool definitions mirror the Schoology tool surface", () => {
  const tools = buildManagedAgentCustomToolDefinitions({ namespace: "schoology" });
  const names = tools.map((tool) => tool.name);

  assert.equal(tools.length, TOOL_NAMES.length);
  assert.ok(names.includes("schoology_list_assignments"));
  assert.ok(names.includes("schoology_update_assignment_status"));
  assert.ok(names.includes("schoology_bulk_update_assignments_by_filter"));
  assert.ok(names.includes("schoology_create_task"));

  const listAssignments = tools.find((tool) => tool.name === "schoology_list_assignments");
  assert.equal(listAssignments.type, "custom");
  assert.equal(listAssignments.input_schema.type, "object");
  assert.ok(listAssignments.input_schema.properties.status);
  assert.ok(listAssignments.input_schema.properties.status.enum.includes("submitted_awaiting_grade"));
  assert.match(listAssignments.description, /List assignments/i);
  assert.match(listAssignments.description, /submitted_awaiting_grade/i);
  assert.match(listAssignments.description, /dueCategory/i);

  const filteredBulk = tools.find(
    (tool) => tool.name === "schoology_bulk_update_assignments_by_filter"
  );
  assert.equal(filteredBulk.input_schema.type, "object");
  assert.ok(filteredBulk.input_schema.properties.targetStatus);
  assert.ok(filteredBulk.input_schema.properties.dueBefore);
  assert.match(filteredBulk.description, /before 4\/4/i);
});
