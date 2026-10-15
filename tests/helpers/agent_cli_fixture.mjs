import assert from "node:assert/strict";
import fs from "node:fs";
import { getConfig, isManagedAgentsRuntime } from "../../src/config.js";
import { getDb, closeDb, listManagedAgentEvents } from "../../src/db.js";
import { readServiceHeartbeat } from "../../src/health.js";
import { streamBytes, sseEvent } from "./managed_stream_fixture.js";

const config = getConfig();
const name = process.env.SCHOOLOGY_CLI_CASE;
const guard = globalThis.__schoologyRouterGuard;
const report = { calls: [], legacyCalls: [], results: [] };
Object.defineProperty(globalThis, "__schoologyCliFixture", { value: {
  legacy(payload) {
    if (name !== "legacy-selected" || isManagedAgentsRuntime(config)) guard.deny("legacy-fallback");
    report.legacyCalls.push(payload);
    return "Legacy fixture reply.";
  },
} });
const message = text => sseEvent("agent.message", { content: [{ type: "text", text }] }, "\r");
const completed = sseEvent("session.status_idle", { stop_reason: { type: "end_turn" } }, "\r");
const action = sseEvent("agent.custom_tool_use", { id: "cli_tool_1", name: "list_assignments", input: { status: "missing", bucketed: false, includePending: true, includeIgnored: true } }, "\r") +
  sseEvent("session.status_idle", { stop_reason: { type: "requires_action", event_ids: ["cli_tool_1"] } }, "\r");
const errorFrame = 'event: error\ndata: {"error":{"message":"private_fixture_marker"}}\n\n';
let streams;
if (name === "refusal" || name === "refusal-empty") streams = [message(name === "refusal" ? "I cannot help with this fixture." : "") + sseEvent("session.status_idle", { stop_reason: { type: "refusal" } })];
else if (name === "budget_reached" || name === "retries_exhausted") streams = [sseEvent("session.status_idle", { stop_reason: { type: name } })];
else if (name === "error-frame") streams = [errorFrame + completed];
else if (name === "malformed-json") streams = ["event: agent.message\ndata: {private_fixture_marker\n\n" + completed];
else if (name === "partial-eof") streams = [message("Partial fixture answer.")];
else if (name === "terminated") streams = [sseEvent("session.status_terminated", {})];
else if (name === "after-tool-error") streams = [action, errorFrame + completed];
else streams = [action, message("Managed fixture reply.") + completed];

guard.installTransport(async (url, options) => {
  assert.equal(options.headers["x-api-key"], "cli-fixture-key-not-real");
  const endpoint = new URL(url).pathname;
  const body = options.body ? JSON.parse(options.body) : null;
  report.calls.push({ endpoint, method: options.method, body });
  if (endpoint === "/v1/sessions") {
    assert.equal(options.method, "POST");
    assert.equal(body.agent, "agent_cli_fixture");
    assert.equal(body.environment_id, "env_cli_fixture");
    assert.equal(body.metadata.chat_id, "local-cli");
    return new Response(JSON.stringify({ id: "sesn_cli_fixture", status: "idle" }));
  }
  if (endpoint === "/v1/sessions/sesn_cli_fixture/events") {
    assert.equal(options.method, "POST");
    for (const event of body.events) if (event.type === "user.custom_tool_result") {
      assert.equal(event.custom_tool_use_id, "cli_tool_1");
      const output = JSON.parse(event.content[0].text);
      assert.equal(output.ok, true);
      assert.equal(output.assignments.length, 1);
      assert.equal(output.assignments[0].title, "CLI fixture worksheet");
      report.results.push({ id: event.custom_tool_use_id, title: output.assignments[0].title });
    }
    return new Response(JSON.stringify({ ok: true }));
  }
  assert.equal(endpoint, "/v1/sessions/sesn_cli_fixture/events/stream");
  assert.equal(options.method, "GET");
  if (name === "http-error") return new Response(JSON.stringify({ error: { message: "fabricated refusal" } }), { status: 503 });
  assert.ok(streams.length, "unexpected extra stream/retry");
  return new Response(streamBytes(streams.shift()), { headers: { "content-type": "text/event-stream" } });
});
process.on("exit", () => {
  if (report.calls.length) {
    report.events = listManagedAgentEvents(getDb(config), { environment: config.managedAgents.sessionNamespace, limit: 20 });
    report.heartbeat = readServiceHeartbeat(config, "managed-agent-bridge");
  }
  report.guard = guard.snapshot();
  closeDb();
  fs.writeFileSync(process.env.SCHOOLOGY_CLI_RECEIPT, JSON.stringify(report), "utf8");
});
