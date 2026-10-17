import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import {
  createCurrentTermSummaryTool,
  currentTermSummaryToolDefinition,
  MAX_TOOL_ITEMS,
  MAX_TOOL_RESULT_BYTES,
  QUALIFIED_CURRENT_TERM_FORMAT,
} from "../plugins/schoology-current-term/adapter.js";

const NOW = "2026-10-17T12:05:00Z";
const ORIGIN = "https://bcps.schoology.com";
const PRIVATE_SENTINEL = "fixture-private-value-must-not-escape";

function row(overrides = {}) {
  return {
    course: "Fixture mathematics",
    title: "Fixture equations",
    dueDate: "2026-10-16T23:59:00-04:00",
    status: "Missing",
    isMissing: true,
    url: `${ORIGIN}/assignment/100`,
    ...overrides,
  };
}

function envelope(assignments = [row()], overrides = {}) {
  return {
    format: QUALIFIED_CURRENT_TERM_FORMAT,
    subjectVerified: true,
    currentTermVerified: true,
    currentTerm: { id: "fixture-period-id", label: "Fixture current term" },
    snapshot: {
      format: "schoology-current-assignments/v1",
      sourceOrigin: ORIGIN,
      observedAt: "2026-10-17T12:00:00Z",
      complete: true,
      assignments,
    },
    ...overrides,
  };
}

function toolFor(input, options = {}) {
  return createCurrentTermSummaryTool({
    readCurrentTermSnapshot: async () => input,
    now: () => new Date(NOW),
    ...options,
  });
}

function expectUnavailable(result, reason) {
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.status, "unavailable");
  assert.equal(result.structuredContent.reason, reason);
  assert.equal(Object.hasOwn(result.structuredContent, "items"), false);
  assert.equal(JSON.stringify(result).includes(PRIVATE_SENTINEL), false);
}

function freezeTree(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freezeTree(child);
    Object.freeze(value);
  }
  return value;
}

test("one explicitly read-only no-argument tool is declared", () => {
  assert.equal(currentTermSummaryToolDefinition.name, "get_current_term_summary");
  assert.deepEqual(currentTermSummaryToolDefinition.inputSchema, {
    type: "object", properties: {}, additionalProperties: false,
  });
  assert.deepEqual(currentTermSummaryToolDefinition.annotations, {
    readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true,
  });
});

test("undefined or an empty JSON object invokes the injected reader with no arguments", async () => {
  let calls = 0;
  const tool = toolFor(null, {
    readCurrentTermSnapshot: async (...args) => {
      assert.deepEqual(args, []);
      calls += 1;
      return envelope();
    },
  });
  for (const args of [undefined, {}]) {
    const result = await tool.call(args);
    assert.equal(result.structuredContent.status, "ready");
  }
  assert.equal(calls, 2);
});

test("arguments cannot select a subject, input, refresh or command and never invoke the reader", async () => {
  let calls = 0;
  const tool = toolFor(null, { readCurrentTermSnapshot: async () => { calls += 1; return envelope(); } });
  for (const args of [
    null, [], "", false, 0, { student: "someone" }, { snapshot: envelope() },
    { term: "previous" }, { url: ORIGIN }, { path: "fixture.json" },
    { refresh: true }, { command: "start" }, { readCurrentTermSnapshot: () => envelope() },
    Object.create({}), { [Symbol("hidden")]: true },
  ]) expectUnavailable(await tool.call(args), "arguments_not_supported");
  assert.equal(calls, 0);
});

test("no reader and reader failure return unavailable without revealing errors", async () => {
  expectUnavailable(await createCurrentTermSummaryTool().call({}), "source_unavailable");
  expectUnavailable(await toolFor(null, {
    readCurrentTermSnapshot: async () => { throw new Error(PRIVATE_SENTINEL); },
  }).call({}), "source_unavailable");
});

test("recent rows alone do not establish principal or current-term scope", async () => {
  const inputs = [
    undefined, null, {}, envelope().snapshot,
    envelope([], { subjectVerified: false }), envelope([], { subjectVerified: "true" }),
    envelope([], { currentTermVerified: false }), envelope([], { currentTerm: null }),
    envelope([], { format: "arbitrary-recent-input" }),
  ];
  const wrongOrigin = envelope();
  wrongOrigin.snapshot.sourceOrigin = "https://other.schoology.com";
  inputs.push(wrongOrigin);
  for (const input of inputs) expectUnavailable(await toolFor(input).call({}), "unverified_current_scope");
});

test("missing and incomplete work use existing selection; submitted work and duplicates do not inflate counts", async () => {
  const first = row();
  const result = await toolFor(envelope([
    first, { ...first },
    row({ title: "Fixture incomplete", status: "Incomplete", url: "/assignment/101" }),
    row({ title: "Fixture submitted", status: "Submitted", url: "/assignment/102" }),
    row({ title: "Fixture complete", status: "Complete", isMissing: false, url: "/assignment/103" }),
  ])).call({});
  assert.equal(result.isError, false);
  assert.equal(result.structuredContent.missingCount, 2);
  assert.equal(result.structuredContent.submittedExcludedCount, 1);
  assert.deepEqual(result.structuredContent.items.map(item => item.title), ["Fixture equations", "Fixture incomplete"]);
  assert.equal(result.structuredContent.returnedCount, 2);
  assert.equal(result.structuredContent.omittedCount, 0);
});

test("only approved assignment fields and bounded metadata leave the adapter; input is unchanged", async () => {
  const input = freezeTree(envelope([row({
    studentId: PRIVATE_SENTINEL, account: PRIVATE_SENTINEL, grade: PRIVATE_SENTINEL,
    score: PRIVATE_SENTINEL, body: PRIVATE_SENTINEL, comments: PRIVATE_SENTINEL,
    notes: PRIVATE_SENTINEL, manualStatus: PRIVATE_SENTINEL, reminders: [PRIVATE_SENTINEL],
  })], { privateContext: PRIVATE_SENTINEL }));
  const before = JSON.stringify(input);
  const result = await toolFor(input).call({});
  assert.equal(result.isError, false);
  assert.deepEqual(Object.keys(result.structuredContent).sort(), [
    "currentTerm", "items", "missingCount", "observedAt", "omittedCount", "returnedCount",
    "sourceComplete", "status", "submittedExcludedCount",
  ]);
  assert.deepEqual(result.structuredContent.currentTerm, { label: "Fixture current term" });
  assert.deepEqual(Object.keys(result.structuredContent.items[0]).sort(), [
    "course", "dueDate", "isMissing", "status", "title", "url",
  ]);
  assert.equal(JSON.stringify(result).includes(PRIVATE_SENTINEL), false);
  assert.equal(JSON.stringify(result).includes("fixture-period-id"), false);
  assert.equal(JSON.stringify(input), before);
});

test("only same-origin HTTPS links survive and query or fragment data is removed", async () => {
  const links = [
    `${ORIGIN}/assignment/100?session=${PRIVATE_SENTINEL}#${PRIVATE_SENTINEL}`,
    "/assignment/101?account=fixture#fragment",
    "https://unrelated.example/assignment/102",
    "https://fixture:credential@bcps.schoology.com/assignment/103",
    "javascript:fixture()",
  ];
  const result = await toolFor(envelope(links.map((url, i) => row({ title: `Fixture ${i}`, url })))).call({});
  assert.equal(result.isError, false);
  assert.deepEqual(result.structuredContent.items.map(item => item.url), [
    `${ORIGIN}/assignment/100`, `${ORIGIN}/assignment/101`, "", "", "",
  ]);
  assert.equal(JSON.stringify(result).includes(PRIVATE_SENTINEL), false);
});

test("stale input is unavailable and freshness is measured after the asynchronous reader completes", async () => {
  let readFinished = false;
  const tool = toolFor(null, {
    readCurrentTermSnapshot: async () => {
      await Promise.resolve();
      readFinished = true;
      return envelope();
    },
    now: () => {
      assert.equal(readFinished, true);
      return new Date("2026-10-17T12:15:00.001Z");
    },
  });
  expectUnavailable(await tool.call({}), "stale_snapshot");
  const boundary = await toolFor(envelope(), { now: () => new Date("2026-10-17T12:15:00Z") }).call({});
  assert.equal(boundary.structuredContent.status, "ready");
});

test("malformed times, coverage, terms, row types and conflicting duplicate records are unavailable", async () => {
  const changes = [
    input => { input.snapshot.observedAt = "2026-10-17T12:06:00.001Z"; },
    input => { input.snapshot.observedAt = "2026-10-17 12:00:00"; },
    input => { input.snapshot.complete = "true"; },
    input => { input.snapshot.format = "saved-db-state"; },
    input => { input.currentTerm.id = ""; },
    input => { input.currentTerm.label = "bad\nlabel"; },
    input => { input.currentTerm.label = "x".repeat(81); },
    input => { input.snapshot.assignments[0].isMissing = "true"; },
    input => { input.snapshot.assignments[0].course = ""; },
    input => { input.snapshot.assignments[0].title = PRIVATE_SENTINEL + "\0"; },
    input => { input.snapshot.assignments[0].status = { value: PRIVATE_SENTINEL }; },
    input => { input.snapshot.assignments = [null]; },
    input => { input.snapshot.assignments.push({ ...input.snapshot.assignments[0], status: "Submitted" }); },
  ];
  for (const change of changes) {
    const input = envelope();
    change(input);
    expectUnavailable(await toolFor(input).call({}), "invalid_snapshot");
  }
  expectUnavailable(await toolFor(envelope(), { timeZone: "invalid/timezone" }).call({}), "invalid_snapshot");
  expectUnavailable(await toolFor(envelope(), { now: () => new Date("invalid") }).call({}), "invalid_snapshot");
});

test("oversized input rows and strings fail before producing an unbounded response", async () => {
  for (const [field, limit] of [["course", 160], ["title", 400], ["dueDate", 100], ["status", 160], ["url", 2048]]) {
    expectUnavailable(await toolFor(envelope([row({ [field]: "x".repeat(limit + 1) })])).call({}), "invalid_snapshot");
  }
  expectUnavailable(await toolFor(envelope(Array.from({ length: 1001 }, () => row()))).call({}), "invalid_snapshot");
});

test("a partial empty view is distinct from a complete empty view", async () => {
  const complete = await toolFor(envelope([])).call({});
  assert.equal(complete.structuredContent.sourceComplete, true);
  assert.match(complete.content[0].text, /No missing assignments in this complete current Schoology snapshot/);
  const input = envelope([]);
  input.snapshot.complete = false;
  const partial = await toolFor(input).call({});
  assert.equal(partial.structuredContent.sourceComplete, false);
  assert.match(partial.content[0].text, /coverage is incomplete/);
  assert.doesNotMatch(partial.content[0].text, /No missing assignments in this complete/);
});

test("row limit reports omitted items separately from original source coverage", async () => {
  const result = await toolFor(envelope(Array.from({ length: 55 }, (_, i) => row({
    title: `Fixture item ${String(i).padStart(3, "0")}`, url: `/assignment/${i}`,
  })))).call({});
  const data = result.structuredContent;
  assert.equal(data.sourceComplete, true);
  assert.equal(data.missingCount, 55);
  assert.equal(data.returnedCount, MAX_TOOL_ITEMS);
  assert.equal(data.items.length, MAX_TOOL_ITEMS);
  assert.equal(data.omittedCount, 5);
  assert.match(result.content[0].text, /50 of 55 missing items; 5 omitted/);
  for (let i = 50; i < 55; i += 1) {
    assert.equal(JSON.stringify(result).includes(`Fixture item ${String(i).padStart(3, "0")}`), false);
  }
});

test("multibyte responses obey the serialized byte budget with exact omission counts", async () => {
  const input = envelope(Array.from({ length: 60 }, (_, i) => row({
    course: "\u8ab2".repeat(160), title: `Fixture item ${String(i).padStart(3, "0")} ${"\u984c".repeat(380)}`,
    status: "\u672a".repeat(160),
    url: `${ORIGIN}/assignment/${i}/${"a".repeat(1950)}`,
  })));
  const result = await toolFor(input).call({});
  const data = result.structuredContent;
  assert.equal(result.isError, false);
  assert.ok(Buffer.byteLength(JSON.stringify(result)) <= MAX_TOOL_RESULT_BYTES);
  assert.ok(data.returnedCount > 0 && data.returnedCount < MAX_TOOL_ITEMS);
  assert.equal(data.items.length, data.returnedCount);
  assert.equal(data.omittedCount, 60 - data.returnedCount);
  assert.equal(data.sourceComplete, true);
  const included = new Set(data.items.map(item => item.title));
  for (const item of input.snapshot.assignments) {
    if (!included.has(item.title)) assert.equal(JSON.stringify(result).includes(item.title), false);
  }
});

test("private source package resolves to the actual adapter, without claiming a portable plugin", async () => {
  const manifest = JSON.parse(await readFile(new URL("../plugins/schoology-current-term/package.json", import.meta.url), "utf8"));
  assert.equal(manifest.name, "schoology-current-term-adapter");
  assert.equal(manifest.private, true);
  assert.equal(manifest.type, "module");
  assert.equal(manifest.exports, "./adapter.js");
});

function guardedImport(code) {
  const env = process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {};
  return spawnSync(process.execPath, [
    "--no-warnings", "--experimental-loader",
    new URL("./helpers/current_term_summary_no_io_loader.mjs", import.meta.url).href,
    "--input-type=module", "--eval", code,
  ], { cwd: new URL("../", import.meta.url), env, encoding: "utf8", timeout: 15000 });
}

test("actual adapter handles ready and unavailable calls with service and I/O imports refused", () => {
  const target = new URL("../plugins/schoology-current-term/adapter.js", import.meta.url).href;
  const result = guardedImport(`
    const { createCurrentTermSummaryTool } = await import(${JSON.stringify(target)});
    const result = await createCurrentTermSummaryTool().call({});
    if (result.structuredContent.reason !== "source_unavailable") throw new Error("unexpected result");
    const tool = createCurrentTermSummaryTool({
      readCurrentTermSnapshot: async () => (${JSON.stringify(envelope())}),
      now: () => new Date(${JSON.stringify(NOW)}),
    });
    const ready = await tool.call({});
    if (ready.structuredContent.status !== "ready" || ready.structuredContent.missingCount !== 1) throw new Error("unexpected fixture result");
    console.log("guarded-adapter-ready-and-unavailable-ok");
  `);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "guarded-adapter-ready-and-unavailable-ok");
});

test("guard negative controls refuse file, network, process, model, database and service imports", () => {
  const forbidden = [
    "node:fs", "node:fs/promises", "fs/promises", "node:child_process", "node:worker_threads",
    "node:http", "node:https", "node:net", "node:dns/promises", "node:sqlite",
    "openai", "better-sqlite3", "playwright", "dotenv", "nodemailer", "twilio", "node-cron",
    new URL("../src/db.js", import.meta.url).href,
    new URL("../src/schoology.js", import.meta.url).href,
    new URL("../src/agent_runtime.js", import.meta.url).href,
    new URL("../src/tasks.js", import.meta.url).href,
  ];
  const result = guardedImport(`
    let refused = 0;
    for (const specifier of ${JSON.stringify(forbidden)}) {
      try { await import(specifier); }
      catch (error) {
        if (!/^CURRENT-(?:SUMMARY-SERVICE|TERM-ADAPTER-IO)-IMPORT-BLOCKED$/.test(error.message)) throw error;
        refused += 1;
        continue;
      }
      throw new Error("forbidden import unexpectedly allowed");
    }
    console.log("guard-controls-refused:" + refused);
  `);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), `guard-controls-refused:${forbidden.length}`);
});
