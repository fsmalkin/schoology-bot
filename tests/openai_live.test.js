import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import OpenAI from "openai";
import { planAction } from "../src/agent.js";

function extractText(response) {
  if (response?.output_text) return response.output_text;
  const output = response?.output;
  if (!Array.isArray(output)) return "";
  return output
    .map((item) => {
      if (!item) return "";
      if (item.type === "output_text" && item.text) return item.text;
      if (item.type === "message" && Array.isArray(item.content)) {
        return item.content.map((part) => (part?.text ? part.text : "")).join("");
      }
      return "";
    })
    .join("");
}


const apiKey = process.env.OPENAI_API_KEY;
const shouldRun = Boolean(apiKey) && process.env.SKIP_LIVE_TESTS !== "1";
const liveTest = shouldRun ? test : test.skip;

liveTest("openai live: json schema format", async () => {
  const client = new OpenAI({ apiKey });
  const model = process.env.OPENAI_MODEL || "gpt-5.2";
  const maxTokens = Number(process.env.OPENAI_LIVE_TEST_TOKENS || 60);

  const schema = {
    type: "object",
    properties: {
      echo: { type: "string" },
    },
    required: ["echo"],
    additionalProperties: false,
  };

  const response = await client.responses.create({
    model,
    reasoning: { effort: "low" },
    max_output_tokens: maxTokens,
    instructions: "Return JSON only.",
    input: "echo ok",
    text: {
      format: {
        type: "json_schema",
        name: "echo_schema",
        strict: true,
        schema,
      },
    },
    tool_choice: "none",
    parallel_tool_calls: false,
  });

  const raw = extractText(response).trim();
  const parsed = JSON.parse(raw);
  assert.ok(typeof parsed.echo === "string");
  assert.ok(parsed.echo.toLowerCase().includes("ok"));
});

const assignmentTools = new Set([
  "list_assignments",
  "update_assignment_status",
  "bulk_update_assignment_statuses",
  "apply_numbered_statuses",
  "add_assignment_note",
  "schedule_reminder",
  "list_assignment_reminders",
  "update_assignment_reminder",
  "delete_assignment_reminder",
  "refresh_schoology",
]);

liveTest("openai live: plan action chooses tool for refresh", async () => {
  const client = new OpenAI({ apiKey });
  const model = process.env.OPENAI_MODEL || "gpt-5.2";
  const plan = await planAction(client, { openai: { model } }, "refresh my assignments");
  assert.ok(["call_tool", "call_tools"].includes(plan.action));
  assert.ok(plan.tool && assignmentTools.has(plan.tool));
});

liveTest("openai live: plan action chooses tool for missing list", async () => {
  const client = new OpenAI({ apiKey });
  const model = process.env.OPENAI_MODEL || "gpt-5.2";
  const plan = await planAction(client, { openai: { model } }, "what are my missing assignments");
  assert.ok(["call_tool", "call_tools"].includes(plan.action));
  assert.ok(plan.tool && assignmentTools.has(plan.tool));
});

liveTest("openai live: plan action handles multi-tool", async () => {
  const client = new OpenAI({ apiKey });
  const model = process.env.OPENAI_MODEL || "gpt-5.2";
  const plan = await planAction(
    client,
    { openai: { model } },
    "refresh my assignments and show missing"
  );
  assert.ok(["call_tool", "call_tools"].includes(plan.action));
  assert.ok(plan.tool && assignmentTools.has(plan.tool));
  if (plan.action === "call_tools") {
    assert.ok(Array.isArray(plan.calls));
    assert.ok(plan.calls.length >= 2);
  }
});

liveTest("openai live: plan action responds without tools", async () => {
  const client = new OpenAI({ apiKey });
  const model = process.env.OPENAI_MODEL || "gpt-5.2";
  const plan = await planAction(client, { openai: { model } }, "thanks");
  assert.ok(["respond", "clarify"].includes(plan.action));
});
