import test from "node:test";
import assert from "node:assert/strict";
import {
  buildManagedAgentDefinition,
  MANAGED_AGENT_ALLOWED_BUILTIN_TOOLS,
  MANAGED_AGENT_MEMORY_BUILTIN_TOOLS,
} from "../src/managed_agent_definitions.js";

test("managed agent system prompt preserves reminder default policy", () => {
  const definition = buildManagedAgentDefinition({ environment: "dev" });

  assert.match(definition.system, /proactively infer reasonable defaults/i);
  assert.match(definition.system, /Times default to America\/New_York/i);
  assert.match(definition.system, /recurrence=weekdays/i);
  assert.match(definition.system, /remindAt=null/i);
  assert.match(definition.system, /unsupported monthly\/custom cadence/i);
  assert.match(definition.system, /recurrence=weekly/i);
  assert.match(definition.system, /submitted-but-ungraded/i);
  assert.match(definition.system, /status=submitted_awaiting_grade/i);
  assert.match(definition.system, /includeIgnored=true/i);
  assert.match(definition.system, /kid-appropriate/i);
  assert.match(definition.system, /web_search and web_fetch/i);
  assert.match(definition.system, /Do not use web tools to search for unsafe/i);
  assert.match(definition.system, /memory may be mounted under \/mnt\/memory/i);
  assert.match(definition.system, /Never store secrets, credentials, tokens/i);
  assert.match(definition.system, /bulk_update_assignments_by_filter/i);
});

test("managed agent enables safe web and memory file built-ins from the agent toolset", () => {
  const definition = buildManagedAgentDefinition({ environment: "dev" });
  const toolset = definition.tools.find((tool) => tool.type === "agent_toolset_20260401");

  assert.ok(toolset, "expected an agent built-in toolset entry");
  assert.equal(toolset.default_config.enabled, false);
  assert.deepEqual(
    toolset.configs.map((config) => config.name).sort(),
    [...MANAGED_AGENT_ALLOWED_BUILTIN_TOOLS].sort()
  );
  assert.equal(toolset.configs.length, MANAGED_AGENT_ALLOWED_BUILTIN_TOOLS.length);
  assert.ok(toolset.configs.every((config) => config.enabled === true));
  assert.ok(
    toolset.configs.every((config) => config.permission_policy?.type === "always_allow")
  );
  for (const name of MANAGED_AGENT_MEMORY_BUILTIN_TOOLS) {
    assert.ok(toolset.configs.some((config) => config.name === name));
  }
  assert.ok(!toolset.configs.some((config) => config.name === "bash"));
  assert.ok(definition.tools.some((tool) => tool.type === "custom" && tool.name === "schoology_list_assignments"));
  assert.ok(
    definition.tools.some(
      (tool) => tool.type === "custom" && tool.name === "schoology_bulk_update_assignments_by_filter"
    )
  );
});
