import test from "node:test";
import assert from "node:assert/strict";
import { buildManagedAgentDefinition } from "../src/managed_agent_definitions.js";

test("managed agent system prompt preserves reminder default policy", () => {
  const definition = buildManagedAgentDefinition({ environment: "dev" });

  assert.match(definition.system, /proactively infer reasonable defaults/i);
  assert.match(definition.system, /Times default to America\/New_York/i);
  assert.match(definition.system, /recurrence=weekdays/i);
  assert.match(definition.system, /remindAt=null/i);
  assert.match(definition.system, /unsupported monthly\/custom cadence/i);
  assert.match(definition.system, /recurrence=weekly/i);
});
