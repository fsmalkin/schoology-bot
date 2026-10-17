import test from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { spawnSync } from "node:child_process";
import { projectCurrentGradebook } from "../src/current_gradebook.js";
import { createCurrentTermGradebookReader } from "../plugins/schoology-current-term/gradebook_reader.js";
import { createCurrentTermMcpHandler, MCP_PROTOCOL_VERSION } from "../plugins/schoology-current-term/mcp_handler.js";
import { currentGradebookFixture, fixtureScope, fixtureStyle } from "./helpers/current_gradebook_fixture.js";

const NOW = "2026-10-17T18:00:00.000Z";
const OBSERVED = "2026-10-17T17:59:30.000Z";
const ORIGIN = "https://bcps.schoology.com";
function project(options = {}, { scope = fixtureScope, observedAt = OBSERVED, origin = ORIGIN, pathname = "/grades/grades", layout = true } = {}) {
  const context = {
    document: currentGradebookFixture(options), URL, observedAt, origin, pathname, expectedScope: scope,
    ...(layout ? { getComputedStyle: fixtureStyle } : {}),
    TextEncoder: undefined, fetch: undefined, process: undefined, require: undefined,
  };
  const value = runInNewContext("(" + projectCurrentGradebook.toString() +
    ")({document,origin,pathname,observedAt,expectedScope})", context, { timeout: 1000 });
  return JSON.parse(JSON.stringify(value));
}
function request(method, params = {}, id = 1) {
  return new Request("https://fixture.example/mcp", {
    method: "POST", headers: {
      "content-type": "application/json", accept: "application/json, text/event-stream",
      "mcp-protocol-version": MCP_PROTOCOL_VERSION,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
}
function handlerFor(observe, { scope = fixtureScope, now = () => new Date(NOW) } = {}) {
  return createCurrentTermMcpHandler({
    now,
    authorizeRequest: async () => ({
      principalId: scope.principalId,
      authorizedScope: { studentId: scope.studentId, currentTermId: scope.currentTermId },
      readCurrentTermSnapshot: createCurrentTermGradebookReader({ scope, observeGradebook: observe }),
    }),
  });
}
const toolCall = (handler, args = {}) => handler(request("tools/call",
  { name: "get_current_term_summary", arguments: args })).then(r => r.json()).then(r => r.result);

test("serialized current-source projection works without TextEncoder or I/O and returns only six fields", () => {
  const result = project();
  assert.equal(result.subjectVerified, true);
  assert.equal(result.currentTermVerified, true);
  assert.deepEqual(result.sourceScope, {
    principalId: fixtureScope.principalId, studentId: fixtureScope.studentId, currentTermId: fixtureScope.currentTermId,
  });
  assert.equal(result.snapshot.observedAt, OBSERVED);
  assert.equal(result.snapshot.complete, true);
  assert.deepEqual(Object.keys(result.snapshot.assignments[0]).sort(),
    ["course", "dueDate", "isMissing", "status", "title", "url"]);
  assert.equal(JSON.stringify(result).includes("fixture-secret"), false);
});

for (const [name, options, context] of [
  ["wrong subject", { studentId: "202" }],
  ["missing account menu", { menu: false }],
  ["ambiguous account menu", { profileCount: 2 }],
  ["wrong period ID", { currentTermId: "other-period" }],
  ["wrong period label", { label: "Different year" }],
  ["two expanded periods", { extraActive: true }],
  ["absent roster", { courses: [] }],
  ["wrong official origin", {}, { origin: "https://unrelated.example" }],
  ["wrong official view", {}, { pathname: "/home" }],
  ["unqualified observation time", {}, { observedAt: "today" }],
  ["unbounded scope", {}, { scope: { ...fixtureScope, studentId: "101\n202" } }],
  ["orphan row", { courses: [{ items: [{ id: "orphan", parent: "missing-parent", status: "Missing" }] }] }],
  ["cyclic row parent", { courses: [{ items: [{ id: "cycle", parent: "cycle", status: "Missing" }] }] }],
  ["duplicate row ID", { courses: [{ items: [{ id: "category-0", status: "Missing" }] }] }],
  ["absent title", { courses: [{ items: [{ omitTitle: true, status: "Missing" }] }] }],
  ["unknown official exception", { courses: [{ items: [{ status: "Unqualified exception" }] }] }],
  ["unqualified collected exception", { courses: [{ items: [{ status: "Collected" }] }] }],
]) {
  test("current-source projection refuses " + name + " with a fixed error", () => {
    assert.throws(() => project(options, context), error => error.message === "Current Schoology source is unavailable.");
  });
}

test("parent-chain membership excludes past work without reading its title or grade", () => {
  const result = project({ courses: [{ items: [
    { title: "Fixture current", status: "Missing" },
    { past: true, omitTitle: true, status: "Unqualified past status" },
  ] }] });
  assert.deepEqual(result.snapshot.assignments.map(r => r.title), ["Fixture current"]);
});

for (const [name, options, context] of [
  ["hidden current item", { courses: [{ items: [{ status: "Missing", hidden: true }] }] }],
  ["collapsed course report", { courses: [{ hidden: true, items: [{ status: "Missing" }] }] }],
  ["remaining pagination", { pagination: true }],
  ["source still loading", { loading: true }],
  ["unavailable layout evidence", {}, { layout: false }],
]) {
  test("source preserves useful rows with explicit partial coverage for " + name, () => {
    const result = project(options, context);
    assert.equal(result.snapshot.complete, false);
    assert.equal(result.snapshot.assignments.length, 1);
  });
}

test("official submitted markers override missing; comments and numeric grade getters are never read", () => {
  const result = project({ courses: [{ items: [
    { status: "Missing", submitted: true }, { status: "Incomplete" }, { status: "" },
    { status: "", href: null, title: "Fixture offline work" },
  ] }] });
  assert.deepEqual(result.snapshot.assignments.map(r => [r.status, r.isMissing]), [
    ["Submitted", false], ["Incomplete", true], ["Not marked missing", false], ["Not marked missing", false],
  ]);
});

test("source strips session query/fragment values and refuses unsafe assignment links without following them", () => {
  const result = project({ courses: [{ items: [
    { status: "Missing", href: "/assignment/1?session=fixture-secret#fixture-secret" },
    { status: "Missing", href: "https://unrelated.example/private" },
    { status: "Missing", href: "https://fixture:secret@bcps.schoology.com/assignment/2" },
  ] }] });
  assert.deepEqual(result.snapshot.assignments.map(r => r.url), [ORIGIN + "/assignment/1", "", ""]);
});

test("source refuses oversized row fields and row count", () => {
  assert.throws(() => project({ courses: [{ items: [{ title: "x".repeat(401), status: "Missing" }] }] }));
  assert.throws(() => project({ courses: [{
    items: Array.from({ length: 1001 }, (_, i) => ({ id: "item-" + i, title: "Fixture " + i, status: "Missing" })),
  }] }));
});

test("MCP initialize/list/call reaches the actual new source reader and subsequent calls observe new state", async () => {
  let calls = 0;
  const handler = handlerFor(async (fixedProjector, scope) => {
    assert.equal(fixedProjector, projectCurrentGradebook);
    assert.equal(Object.isFrozen(scope), true);
    return project({ courses: [{ items: [{
      title: "Fixture changing work", status: "Missing", submitted: calls++ > 0,
    }] }] }, { scope });
  });
  const init = await handler(request("initialize", {
    protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "fixture-chat-client", version: "1" },
  })).then(r => r.json());
  assert.equal(init.result.protocolVersion, MCP_PROTOCOL_VERSION);
  const listed = await handler(request("tools/list")).then(r => r.json());
  assert.equal(listed.result.tools[0].name, "get_current_term_summary");
  assert.equal(calls, 0);
  const first = await toolCall(handler);
  assert.equal(first.structuredContent.missingCount, 1);
  assert.equal(first.structuredContent.items[0].title, "Fixture changing work");
  const second = await toolCall(handler);
  assert.equal(second.structuredContent.missingCount, 0);
  assert.equal(second.structuredContent.submittedExcludedCount, 1);
  assert.equal(calls, 2);
});

test("source reader uses copied request scope and never exposes arbitrary selectors, subjects or model arguments", async () => {
  const scope = { ...fixtureScope };
  let calls = 0;
  const reader = createCurrentTermGradebookReader({
    scope, observeGradebook: async (_, bound) => { calls++; return project({}, { scope: bound }); },
  });
  scope.studentId = "202";
  assert.equal((await reader()).sourceScope.studentId, "101");
  assert.equal(await reader({ studentId: "202" }), null);
  const result = await toolCall(handlerFor(async () => { calls++; return project(); }), { studentId: "202" });
  assert.equal(result.structuredContent.reason, "arguments_not_supported");
  assert.equal(calls, 1);
});

test("reader is unavailable without an exact observer/scope or when source scope mismatches", async () => {
  assert.equal(await createCurrentTermGradebookReader()(), null);
  assert.equal(await createCurrentTermGradebookReader({ scope: fixtureScope })(), null);
  for (const key of ["principalId", "studentId", "currentTermId"]) {
    const reader = createCurrentTermGradebookReader({
      scope: fixtureScope, observeGradebook: async () => {
        const input = project(); input.sourceScope[key] = "different"; return input;
      },
    });
    assert.equal(await reader(), null);
  }
});

test("source exceptions, mismatches and stale data remain opaque unavailable tool replies", async () => {
  const failed = await toolCall(handlerFor(async () => { throw new Error("fixture-secret"); }));
  assert.equal(failed.isError, true);
  assert.equal(JSON.stringify(failed).includes("fixture-secret"), false);
  const mismatch = await toolCall(handlerFor(async () => project({ studentId: "202" })));
  assert.equal(mismatch.isError, true);
  const stale = await toolCall(handlerFor(async () => project({}, { observedAt: "2026-10-17T17:44:00.000Z" })));
  assert.equal(stale.structuredContent.reason, "stale_snapshot");
});

test("freshness is checked after a slow source observation, not relabeled by the new reader", async () => {
  let now = new Date(NOW);
  const handler = handlerFor(async () => {
    const input = project();
    now = new Date("2026-10-17T18:16:00.000Z");
    return input;
  }, { now: () => now });
  assert.equal((await toolCall(handler)).structuredContent.reason, "stale_snapshot");
});

test("two callers and their independent current documents remain separated during interleaved tool calls", async () => {
  const make = (studentId, title) => {
    const scope = { ...fixtureScope, studentId, principalId: "fixture-" + studentId };
    return handlerFor(async (_, fixed) => {
      await Promise.resolve();
      return project({ studentId, courses: [{ items: [{ title, status: "Missing" }] }] }, { scope: fixed });
    }, { scope });
  };
  const [a, b] = await Promise.all([toolCall(make("101", "Fixture A")), toolCall(make("202", "Fixture B"))]);
  assert.equal(a.structuredContent.items[0].title, "Fixture A");
  assert.equal(b.structuredContent.items[0].title, "Fixture B");
  assert.equal(JSON.stringify(a).includes("Fixture B"), false);
});

test("actual new source/reader imports under the existing no-I/O guard", () => {
  const target = new URL("../plugins/schoology-current-term/gradebook_reader.js", import.meta.url).href;
  const code = "const {createCurrentTermGradebookReader}=await import(" + JSON.stringify(target) +
    "); if(await createCurrentTermGradebookReader()()!==null)throw new Error('bad default'); console.log('guarded-gradebook-reader-ok');";
  const result = spawnSync(process.execPath, ["--no-warnings", "--experimental-loader",
    new URL("./helpers/current_term_summary_no_io_loader.mjs", import.meta.url).href,
    "--input-type=module", "--eval", code], {
    env: process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {},
    encoding: "utf8", timeout: 15000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "guarded-gradebook-reader-ok");
});
