import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
const helper = file => path.join(root, "tests/helpers", file);
function run(t, name, args, { stack = "managed-agents", enabled = "0", control = false } = {}) {
  const parent = fs.realpathSync(os.tmpdir());
  const sandbox = fs.mkdtempSync(path.join(parent, "schoology-cli-fixture-"));
  t.after(() => {
    const resolved = fs.realpathSync(sandbox);
    assert.equal(path.dirname(resolved), parent);
    assert.ok(path.basename(resolved).startsWith("schoology-cli-fixture-"));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  const dataDir = path.join(sandbox, "data");
  fs.mkdirSync(dataDir);
  const envFile = path.join(sandbox, "selected-empty.env");
  fs.writeFileSync(envFile, "");
  fs.writeFileSync(path.join(dataDir, "state.json"), JSON.stringify({ assignments: { "fixture-1": {
    key: "fixture-1", title: "CLI fixture worksheet", course: "Fixture Math", status: "Missing", isMissing: true,
    dueDate: "2026-10-14", url: "", rawText: "", score: "", firstSeenAt: "2026-10-14T12:00:00Z",
    lastSeenAt: "2026-10-14T12:00:00Z", lastMissingAt: "2026-10-14T12:00:00Z",
  } } }));
  const env = {};
  for (const key of ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "windir", "COMSPEC"]) if (process.env[key]) env[key] = process.env[key];
  Object.assign(env, {
    TEMP: sandbox, TMP: sandbox, NODE_NO_WARNINGS: "1", DOTENV_CONFIG_PATH: envFile,
    SCHOOLOGY_ROUTER_SOURCE: root, SCHOOLOGY_ROUTER_SANDBOX: sandbox, SCHOOLOGY_CLI_CASE: name,
    SCHOOLOGY_CLI_RECEIPT: path.join(sandbox, "receipt.json"), DATA_DIR: dataDir,
    STATE_PATH: path.join(dataDir, "state.json"), AGENT_DB_PATH: ":memory:",
    RUNTIME_STACK: stack, MANAGED_AGENTS_ENABLED: enabled, MANAGED_AGENTS_ENV: "dev",
    MANAGED_AGENT_SESSION_NAMESPACE: "schoology-cli-fixture", ANTHROPIC_API_KEY: "cli-fixture-key-not-real",
    CLAUDE_MANAGED_AGENT_ID: name === "missing-agent" ? "" : "agent_cli_fixture",
    CLAUDE_MANAGED_ENVIRONMENT_ID: "env_cli_fixture", ANTHROPIC_BASE_URL: "https://router-fixture.invalid",
    MANAGED_AGENT_STREAM_TIMEOUT_MS: "1000", MANAGED_AGENT_MAX_TOOL_ROUNDS: "3",
    AUTO_IGNORE_ENABLED: "0", AUTO_UPCOMING_ENABLED: "0", LOGIN_ALERTS_ENABLED: "0",
  });
  const entry = control ? helper("agent_cli_guard_control.mjs") : path.join(root, "src/agent_cli.js");
  const result = spawnSync(process.execPath, [
    "--experimental-loader", pathToFileURL(helper("agent_cli_guard_loader.mjs")).href,
    "--import", pathToFileURL(helper("agent_cli_guard_preload.mjs")).href,
    "--import", pathToFileURL(helper("agent_cli_fixture.mjs")).href,
    entry, ...args,
  ], { cwd: root, env, encoding: "utf8", timeout: 15000 });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  const receipt = JSON.parse(fs.readFileSync(env.SCHOOLOGY_CLI_RECEIPT, "utf8"));
  const stderr = result.stderr.replace(/^ROUTER-GUARD-COUNTS .*\r?\n/gm, "");
  return { ...result, stderr, receipt };
}

for (const args of [[], [" ", " "]]) test(`actual CLI preserves usage/exit1 for ${args.length ? "blank" : "absent"} message`, t => {
  const r = run(t, "usage", args);
  assert.equal(r.status, 1);
  assert.equal(r.stdout, "");
  assert.equal(r.stderr, 'Usage: npm run agent:cli -- "your message"\n');
  assert.deepEqual(r.receipt, { calls: [], legacyCalls: [], results: [], guard: {} });
});

for (const [name, options, args] of [
  ["stack-route", {}, ["  First ", "Second  "]],
  ["enabled-route", { stack: "legacy", enabled: "1" }, ["List", "fixture assignments."]],
  ["positional-arguments", {}, ["--runtime", "managed-agents"]],
]) test(`actual CLI uses configured managed route (${name}) and preserves argv/local-cli/stdout`, t => {
  const r = run(t, name, args, options);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, "Managed fixture reply.\n");
  assert.equal(r.stderr, "");
  const { calls, legacyCalls, results, events, heartbeat, guard } = r.receipt;
  assert.deepEqual(guard, {});
  assert.deepEqual(legacyCalls, []);
  assert.equal(calls.length, 5);
  assert.equal(calls[0].body.metadata.chat_id, "local-cli");
  assert.equal(calls[1].body.events[0].content[0].text, args.join(" ").trim());
  assert.deepEqual(results, [{ id: "cli_tool_1", title: "CLI fixture worksheet" }]);
  assert.equal(events[0].eventType, "turn_completed");
  assert.equal(events[0].status, "ok");
  assert.equal(heartbeat.lastEventType, "turn_completed");
});

test("actual CLI preserves selected legacy routing through a controlled fake target", t => {
  const r = run(t, "legacy-selected", ["  Legacy", "message  "], { stack: "legacy" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, "Legacy fixture reply.\n");
  assert.equal(r.stderr, "");
  assert.deepEqual(r.receipt.calls, []);
  assert.deepEqual(r.receipt.guard, {});
  assert.deepEqual(r.receipt.legacyCalls, [{ chatId: "local-cli", text: "Legacy message" }]);
});

for (const name of ["refusal", "refusal-empty"]) test(`actual CLI preserves ${name} as refusal text with blocked bookkeeping`, t => {
  const r = run(t, name, ["fixture"]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, (name === "refusal" ? "I cannot help with this fixture." : "Claude declined this request.") + "\n");
  assert.equal(r.stderr, "");
  assert.equal(r.receipt.calls.length, 3);
  assert.equal(r.receipt.events[0].eventType, "turn_refused");
  assert.equal(r.receipt.events[0].status, "blocked");
  assert.equal(r.receipt.heartbeat.status, "blocked");
  assert.deepEqual(r.receipt.legacyCalls, []);
  assert.deepEqual(r.receipt.guard, {});
});

for (const [name, expected] of [
  ["budget_reached", /budget_reached/], ["retries_exhausted", /retries_exhausted/],
  ["error-frame", /stream error/], ["malformed-json", /invalid JSON/],
  ["partial-eof", /ended without confirmed/], ["terminated", /terminated without confirmed/],
  ["after-tool-error", /stream error/], ["missing-agent", /Missing Managed Agents config.*CLAUDE_MANAGED_AGENT_ID/],
  ["http-error", /API error 503: fabricated refusal/],
]) test(`actual CLI preserves error/exit1 without fallback for ${name}`, t => {
  const r = run(t, name, ["fixture"]);
  assert.equal(r.status, 1, r.stderr);
  assert.equal(r.stdout, "");
  assert.match(r.stderr, expected);
  assert.doesNotMatch(r.stderr, /private_fixture_marker|Done\./);
  assert.deepEqual(r.receipt.legacyCalls, []);
  assert.deepEqual(r.receipt.guard, {});
  assert.equal(r.receipt.calls.length, name === "missing-agent" ? 0 : name === "after-tool-error" ? 5 : 3);
  if (r.receipt.calls.length) {
    assert.equal(r.receipt.events[0].eventType, "turn_error");
    assert.equal(r.receipt.events.some(event => event.eventType === "turn_completed"), false);
    assert.equal(r.receipt.heartbeat.status, "error");
  }
  assert.equal(r.receipt.results.length, name === "after-tool-error" ? 1 : 0);
});

for (const [control, kind] of [["network", "network"], ["dotenv", "dotenv-file"], ["file-env", "protected-file"], ["legacy", "legacy-fallback"]]) {
  test(`CLI guard negative control refuses ${control} before an external/local effect`, t => {
    const r = run(t, "guard-control", [control], { control: true });
    assert.equal(r.status, 95, r.stderr);
    assert.deepEqual(r.receipt.guard, { [kind]: 1 });
    assert.deepEqual(r.receipt.calls, []);
    assert.deepEqual(r.receipt.legacyCalls, []);
  });
}
