import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  createCurrentTermMcpHandler,
  MAX_MCP_REQUEST_BYTES,
  MAX_MCP_RESPONSE_BYTES,
  MCP_PROTOCOL_VERSION,
} from "../plugins/schoology-current-term/mcp_handler.js";

// Explicit standard Web APIs for these fabricated, in-process HTTP fixtures.
// This is Node request/response coverage, not a Worker VM or browser build.
const web = Object.freeze({
  Request: globalThis.Request, Response: globalThis.Response, Headers: globalThis.Headers,
  URL: globalThis.URL, TextEncoder: globalThis.TextEncoder, TextDecoder: globalThis.TextDecoder,
  ReadableStream: globalThis.ReadableStream, Uint8Array: globalThis.Uint8Array,
});
for (const [name, value] of Object.entries(web)) assert.equal(typeof value, "function", `${name} is required`);

const PRIVATE = "fixture-private-payload-must-not-escape";
const NOW = "2026-10-17T12:05:00Z";
const TOOL = "get_current_term_summary";
const CONTEXT = Object.freeze({ serverOnly: "fixture-context" });

function snapshot(title = "Fixture subject A assignment", scope = {}) {
  return {
    format: "schoology-qualified-current-term/v1", subjectVerified: true, currentTermVerified: true,
    currentTerm: { id: "fixture-period", label: "Fixture current term" },
    sourceScope: { principalId: "fixture-private-principal", studentId: "fixture-student-A", currentTermId: "fixture-period", ...scope },
    snapshot: {
      format: "schoology-current-assignments/v1", sourceOrigin: "https://bcps.schoology.com",
      observedAt: "2026-10-17T12:00:00Z", complete: true,
      assignments: [{ course: "Fixture course", title, dueDate: "", status: "Missing", isMissing: true, url: "/assignment/100" }],
    },
  };
}

function message(method = "tools/call", params = { name: TOOL, arguments: {} }, id = 1) {
  return { jsonrpc: "2.0", id, method, params };
}

function request(body = message(), { method = "POST", headers = {}, url = "https://fixture.example/mcp", raw = false } = {}) {
  const init = {
    method,
    headers: new web.Headers({
      Accept: "application/json, text/event-stream", "Content-Type": "application/json; charset=utf-8",
      "MCP-Protocol-Version": MCP_PROTOCOL_VERSION, ...headers,
    }),
  };
  if (method !== "GET" && method !== "HEAD") init.body = raw ? body : JSON.stringify(body);
  if (body instanceof web.ReadableStream) init.duplex = "half";
  return new web.Request(url, init);
}

function fixture({ input = snapshot(), reader, authorizeRequest, ...options } = {}) {
  let reads = 0;
  let authorizations = 0;
  const handler = createCurrentTermMcpHandler({
    now: () => new Date(NOW), ...options,
    authorizeRequest: authorizeRequest || (async context => {
      authorizations += 1;
      if (context !== CONTEXT) return null;
      return { principalId: "fixture-private-principal", authorizedScope: { studentId: "fixture-student-A", currentTermId: "fixture-period" }, readCurrentTermSnapshot: async (...args) => {
        assert.deepEqual(args, []);
        reads += 1;
        return reader ? reader() : input;
      } };
    }),
  });
  return { handler, reads: () => reads, authorizations: () => authorizations };
}

async function errorIs(response, status, code, id = null) {
  assert.ok(response instanceof web.Response);
  assert.equal(response.status, status);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json();
  assert.equal(body.jsonrpc, "2.0");
  assert.equal(body.id, id);
  assert.equal(body.error.code, code);
  assert.equal(Object.hasOwn(body, "result"), false);
  assert.equal(JSON.stringify(body).includes(PRIVATE), false);
  return body;
}

test("no host authorization refuses discovery and calls despite forged identity or qualification data", async () => {
  const handler = createCurrentTermMcpHandler();
  for (const body of [message("tools/list", {}), message("tools/call", { name: TOOL, arguments: snapshot() })]) {
    await errorIs(await handler(request(body, { headers: {
      "oai-authenticated-user-id": "pretend-subject", "Authorization": "Bearer fixture-only",
    } }), { principalId: "pretend-subject", authorized: true, subjectVerified: true }), 401, -32000);
  }
});

test("host authorization is evaluated for every request; malformed grants or exceptions fail closed", async () => {
  for (const grant of [true, false, {}, { authorized: true }, { principalId: "A" }, { principalId: "", readCurrentTermSnapshot: () => snapshot() }]) {
    const handler = createCurrentTermMcpHandler({ authorizeRequest: async () => grant });
    await errorIs(await handler(request(), CONTEXT), 403, -32000);
  }
  const handler = createCurrentTermMcpHandler({ authorizeRequest: async () => { throw new Error(PRIVATE); } });
  await errorIs(await handler(request(), CONTEXT), 403, -32000);
  const f = fixture();
  await errorIs(await f.handler(request(), { ...CONTEXT }), 401, -32000);
  assert.equal(f.reads(), 0);
});

test("initialize negotiates the pinned profile without reading private data or issuing a session", async () => {
  const f = fixture();
  for (const requested of [MCP_PROTOCOL_VERSION, "2024-11-05"]) {
    const req = request(message("initialize", {
      protocolVersion: requested, capabilities: {}, clientInfo: { name: "fixture-client", version: "1.0" },
    }, 0));
    req.headers.delete("MCP-Protocol-Version");
    const response = await f.handler(req, CONTEXT);
    assert.equal(response.status, 200);
    assert.equal(response.headers.has("mcp-session-id"), false);
    assert.deepEqual(await response.json(), { jsonrpc: "2.0", id: 0, result: {
      protocolVersion: MCP_PROTOCOL_VERSION, capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "schoology-current-term", version: "0.1.0" },
    } });
  }
  assert.equal(f.reads(), 0);
  assert.equal(f.authorizations(), 2);
});

test("tools/list and ping contain only tool metadata with no source read", async () => {
  const f = fixture();
  const listing = await (await f.handler(request(message("tools/list", {})), CONTEXT)).json();
  assert.equal(listing.result.tools.length, 1);
  assert.equal(listing.result.tools[0].name, TOOL);
  assert.equal(listing.result.tools[0].inputSchema.additionalProperties, false);
  assert.deepEqual(listing.result.tools[0].annotations, {
    readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true,
  });
  assert.equal(JSON.stringify(listing).includes("fixture-private-principal"), false);
  const ping = await (await f.handler(request(message("ping", {}, "fixture-id")), CONTEXT)).json();
  assert.deepEqual(ping, { jsonrpc: "2.0", id: "fixture-id", result: {} });
  assert.equal(f.reads(), 0);
});

test("the actual accepted tool runs with empty or omitted arguments and a fixed request-bound reader", async () => {
  const f = fixture();
  for (const params of [{ name: TOOL }, { name: TOOL, arguments: {} }]) {
    const response = await f.handler(request(message("tools/call", params)), CONTEXT);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /^application\/json/);
    const body = await response.json();
    assert.equal(body.result.isError, false);
    assert.equal(body.result.structuredContent.items[0].title, "Fixture subject A assignment");
    assert.equal(JSON.stringify(body).includes("fixture-private-principal"), false);
    assert.equal(JSON.stringify(body).includes("fixture-student-A"), false);
    assert.equal(JSON.stringify(body).includes("sourceScope"), false);
  }
  assert.equal(f.reads(), 2);
});

test("model arguments cannot choose a student, snapshot, history, refresh, path or command", async () => {
  const f = fixture();
  for (const args of [{ studentId: "B" }, snapshot(), { refresh: true }, { history: true }, { path: PRIVATE }, { command: PRIVATE }]) {
    const response = await f.handler(request(message("tools/call", { name: TOOL, arguments: args })), CONTEXT);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.result.isError, true);
    assert.equal(body.result.structuredContent.reason, "arguments_not_supported");
    assert.equal(JSON.stringify(body).includes(PRIVATE), false);
  }
  assert.equal(f.reads(), 0);
});

test("request metadata and identity headers cannot replace trusted host context or select another reader", async () => {
  const f = fixture();
  const req = request(message("tools/call", { name: TOOL, _meta: { studentId: "B", subjectVerified: true } }), {
    headers: { "oai-authenticated-user-id": "B", "MCP-Session-Id": "borrowed-session" },
  });
  const body = await (await f.handler(req, CONTEXT)).json();
  assert.equal(body.result.structuredContent.items[0].title, "Fixture subject A assignment");
  assert.equal(f.reads(), 1);
});

test("a provider belonging to another caller, student or period cannot return assignment data", async () => {
  for (const scope of [
    { principalId: "another-caller" }, { studentId: "fixture-student-B" }, { currentTermId: "another-period" },
  ]) {
    const f = fixture({ input: snapshot(PRIVATE, scope) });
    const response = await f.handler(request(), CONTEXT);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.result.structuredContent.reason, "unverified_current_scope");
    assert.equal(JSON.stringify(body).includes(PRIVATE), false);
    assert.equal(Object.hasOwn(body.result.structuredContent, "items"), false);
    assert.equal(f.reads(), 1);
  }
  for (const change of [input => { delete input.sourceScope; }, input => { input.currentTerm.id = "wrong-period"; }]) {
    const input = snapshot(PRIVATE); change(input);
    const f = fixture({ input });
    const body = await (await f.handler(request(), CONTEXT)).json();
    assert.equal(body.result.structuredContent.reason, "unverified_current_scope");
    assert.equal(JSON.stringify(body).includes(PRIVATE), false);
  }
});

test("a principal or booleans without an authorized student/period capability never access a provider", async () => {
  let reads = 0;
  const handler = createCurrentTermMcpHandler({ authorizeRequest: async () => ({
    principalId: "fixture-private-principal", authorized: true, subjectVerified: true,
    readCurrentTermSnapshot: async () => { reads += 1; return snapshot(); },
  }) });
  await errorIs(await handler(request(), CONTEXT), 403, -32000);
  assert.equal(reads, 0);
});

test("two concurrent synthetic subjects keep their own readers and a later denial cannot reuse a prior grant", async () => {
  const contextA = Object.freeze({ fixture: "A" });
  const contextB = Object.freeze({ fixture: "B" });
  let releaseA;
  const gateA = new Promise(resolve => { releaseA = resolve; });
  let readsA = 0;
  let readsB = 0;
  const grants = new Map([
    [contextA, { principalId: "private-principal-A", authorizedScope: { studentId: "student-A", currentTermId: "fixture-period" }, readCurrentTermSnapshot: async () => {
      readsA += 1; await gateA; return snapshot("Subject A only", { principalId: "private-principal-A", studentId: "student-A" });
    } }],
    [contextB, { principalId: "private-principal-B", authorizedScope: { studentId: "student-B", currentTermId: "fixture-period" }, readCurrentTermSnapshot: async () => {
      readsB += 1; return snapshot("Subject B only", { principalId: "private-principal-B", studentId: "student-B" });
    } }],
  ]);
  let authorizations = 0;
  const handler = createCurrentTermMcpHandler({ now: () => new Date(NOW), authorizeRequest: async context => {
    authorizations += 1; return grants.get(context) ?? null;
  } });
  const pendingA = handler(request(), contextA);
  const responseB = await handler(request(), contextB);
  const resultB = await responseB.json();
  releaseA();
  const resultA = await (await pendingA).json();
  assert.equal(resultA.result.structuredContent.items[0].title, "Subject A only");
  assert.equal(resultB.result.structuredContent.items[0].title, "Subject B only");
  assert.equal(JSON.stringify(resultA).includes("Subject B only"), false);
  assert.equal(JSON.stringify(resultB).includes("Subject A only"), false);
  assert.equal(JSON.stringify([resultA, resultB]).includes("private-principal"), false);
  grants.delete(contextA);
  await errorIs(await handler(request(), contextA), 401, -32000);
  await handler(request(), contextB);
  assert.equal(authorizations, 4);
  assert.equal(readsA, 1);
  assert.equal(readsB, 2);
});

test("unqualified, stale and failing sources remain opaque tool errors over the protocol", async () => {
  const stale = snapshot(); stale.snapshot.observedAt = "2026-10-16T12:00:00Z";
  for (const [options, reason] of [
    [{ input: null }, "unverified_current_scope"],
    [{ input: stale }, "stale_snapshot"],
    [{ reader: async () => { throw new Error(PRIVATE); } }, "source_unavailable"],
  ]) {
    const f = fixture(options);
    const body = await (await f.handler(request(), CONTEXT)).json();
    assert.equal(body.result.isError, true);
    assert.equal(body.result.structuredContent.reason, reason);
    assert.equal(JSON.stringify(body).includes(PRIVATE), false);
  }
});

test("wrong paths, browser origins, methods and media types are refused before host or reader use", async () => {
  const f = fixture();
  const cases = [
    [request(message(), { url: "https://fixture.example/other" }), 404],
    [request(message(), { url: "https://fixture.example/mcp?student=B" }), 404],
    [request(message(), { headers: { Origin: "https://untrusted.example" } }), 403],
    [request(undefined, { method: "GET" }), 405],
    [request(undefined, { method: "DELETE" }), 405],
    [request(message(), { headers: { Accept: "application/json" } }), 406],
    [request(message(), { headers: { Accept: "application/json, text/event-stream;q=0" } }), 406],
    [request(message(), { headers: { "Content-Type": "text/plain" } }), 415],
    [request(message(), { headers: { "Content-Type": "application/json; charset=iso-8859-1" } }), 415],
  ];
  for (const [req, status] of cases) {
    const response = await f.handler(req, CONTEXT);
    assert.equal(response.status, status);
    if (status === 405) assert.equal(response.headers.get("allow"), "POST");
  }
  assert.equal(f.reads(), 0);
  assert.equal(f.authorizations(), 0);
});

test("browser origins require an explicit exact HTTPS allowlist", async () => {
  assert.throws(() => createCurrentTermMcpHandler({ allowedOrigins: ["https://fixture.example/path"] }));
  assert.throws(() => createCurrentTermMcpHandler({ allowedOrigins: ["http://fixture.example"] }));
  const f = fixture({ allowedOrigins: ["https://fixture.example"] });
  const response = await f.handler(request(message("ping", {}), { headers: { Origin: "https://fixture.example" } }), CONTEXT);
  assert.equal(response.status, 200);
  await errorIs(await f.handler(request(message(), { headers: { Origin: "null" } }), CONTEXT), 403, -32000);
});

test("malformed JSON, UTF-8, batches and request shapes return fixed protocol errors without reading a source", async () => {
  const f = fixture();
  for (const raw of ["{", PRIVATE, new web.Uint8Array([0xff])]) {
    await errorIs(await f.handler(request(raw, { raw: true }), CONTEXT), 400, -32700);
  }
  for (const body of [[], [message()], null, 3, { ...message(), id: null }, { ...message(), id: 1.5 },
    { ...message(), id: "x".repeat(129) }, { ...message(), jsonrpc: "1.0" }, { ...message(), studentId: "B" }]) {
    await errorIs(await f.handler(request(body), CONTEXT), 400, -32600);
  }
  assert.equal(f.reads(), 0);
});

test("unknown methods/tools and invalid method params remain protocol errors, not arbitrary execution", async () => {
  const f = fixture();
  for (const [body, code] of [
    [message(PRIVATE, {}), -32601],
    [message("tools/call", { name: PRIVATE }), -32602],
    [message("tools/call", { name: TOOL, studentId: "B" }), -32602],
    [message("tools/call", { name: TOOL, arguments: null }), -32602],
    [message("tools/call", { name: TOOL, arguments: [] }), -32602],
    [message("tools/list", { cursor: "fixture-cursor" }), -32602],
    [message("initialize", {}), -32602],
    [message("ping", null), -32602],
  ]) await errorIs(await f.handler(request(body), CONTEXT), 400, code, 1);
  assert.equal(f.reads(), 0);
});

test("unsupported or missing operation protocol versions are refused without session fallback", async () => {
  const f = fixture();
  await errorIs(await f.handler(request(message(), { headers: { "MCP-Protocol-Version": "2026-07-28" } }), CONTEXT), 400, -32600, 1);
  const req = request(); req.headers.delete("MCP-Protocol-Version");
  await errorIs(await f.handler(req, CONTEXT), 400, -32600, 1);
  assert.equal(f.reads(), 0);
});

test("notifications return empty202 and cannot execute a tool or create a cached session", async () => {
  const f = fixture();
  for (const body of [
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", method: "tools/call", params: { name: TOOL, arguments: {} } },
  ]) {
    const response = await f.handler(request(body), CONTEXT);
    assert.equal(response.status, 202);
    assert.equal(await response.text(), "");
    assert.equal(response.headers.has("mcp-session-id"), false);
  }
  assert.equal(f.reads(), 0);
});

test("request bytes are bounded with and without declared length and oversized streams are cancelled", async () => {
  const f = fixture();
  await errorIs(await f.handler(request(PRIVATE, { raw: true, headers: { "Content-Length": "invalid" } }), CONTEXT), 400, -32600);
  await errorIs(await f.handler(request(PRIVATE, { raw: true, headers: { "Content-Length": String(MAX_MCP_REQUEST_BYTES + 1) } }), CONTEXT), 413, -32600);
  let cancelled = false;
  const stream = new web.ReadableStream({
    pull(controller) { controller.enqueue(new web.Uint8Array(MAX_MCP_REQUEST_BYTES + 1)); },
    cancel() { cancelled = true; },
  });
  await errorIs(await f.handler(request(stream, { raw: true }), CONTEXT), 413, -32600);
  assert.equal(cancelled, true);
  assert.equal(f.reads(), 0);
});

test("stream failures and invalid chunks produce opaque parse errors and release the body", async () => {
  const f = fixture();
  const failed = new web.ReadableStream({ start(controller) { controller.error(new Error(PRIVATE)); } });
  await errorIs(await f.handler(request(failed, { raw: true }), CONTEXT), 400, -32700);
  let cancelled = false;
  const invalid = new web.ReadableStream({
    pull(controller) { controller.enqueue(PRIVATE); },
    cancel() { cancelled = true; },
  });
  await errorIs(await f.handler(request(invalid, { raw: true }), CONTEXT), 400, -32700);
  assert.equal(cancelled, true);
  assert.equal(f.reads(), 0);
});

test("unexpected handler exceptions return a fixed internal error without exposing host details", async () => {
  const handler = createCurrentTermMcpHandler({ authorizeRequest: async () => ({
    get principalId() { throw new Error(PRIVATE); },
  }) });
  const body = await errorIs(await handler(request(), CONTEXT), 500, -32603);
  assert.equal(body.error.message, "Internal error");
});

test("large fabricated results retain adapter field/byte/omission limits within the MCP envelope", async () => {
  const input = snapshot();
  input.snapshot.assignments = Array.from({ length: 65 }, (_, i) => ({
    course: "\u8ab2".repeat(150), title: `Item ${String(i).padStart(3, "0")} ${"\u984c".repeat(370)}`,
    dueDate: "", status: "Missing", isMissing: true,
    url: `https://bcps.schoology.com/assignment/${i}/${"a".repeat(1900)}`,
    notes: PRIVATE,
  }));
  const f = fixture({ input });
  const response = await f.handler(request(), CONTEXT);
  assert.equal(response.status, 200);
  const bodyText = await response.text();
  assert.ok(new web.TextEncoder().encode(bodyText).length <= MAX_MCP_RESPONSE_BYTES);
  assert.equal(bodyText.includes(PRIVATE), false);
  const result = JSON.parse(bodyText).result.structuredContent;
  assert.equal(result.missingCount, 65);
  assert.equal(result.sourceComplete, true);
  assert.ok(result.returnedCount > 0 && result.returnedCount < 50);
  assert.equal(result.omittedCount, 65 - result.items.length);
  const selected = new Set(result.items.map(item => item.title));
  for (const item of input.snapshot.assignments) if (!selected.has(item.title)) assert.equal(bodyText.includes(item.title), false);
});

test("actual handler request/response import path works under the existing no-I/O/service guard", () => {
  const target = new web.URL("../plugins/schoology-current-term/mcp_handler.js", import.meta.url).href;
  const loader = new web.URL("./helpers/current_term_summary_no_io_loader.mjs", import.meta.url).href;
  const code = `
    const web = { Request, Response, Headers, URL, TextEncoder, TextDecoder, ReadableStream, Uint8Array };
    for (const value of Object.values(web)) if (typeof value !== "function") throw new Error("missing Web API");
    const { createCurrentTermMcpHandler } = await import(${JSON.stringify(target)});
    const context = {};
    const handler = createCurrentTermMcpHandler({
      now: () => new Date(${JSON.stringify(NOW)}),
      authorizeRequest: async value => value === context ? {
        principalId: "fixture-private-principal", authorizedScope: { studentId: "fixture-student-A", currentTermId: "fixture-period" }, readCurrentTermSnapshot: async () => (${JSON.stringify(snapshot())})
      } : null,
    });
    const makeRequest = () => new web.Request("https://fixture.example/mcp", {
      method: "POST", headers: { Accept: "application/json, text/event-stream", "Content-Type": "application/json", "MCP-Protocol-Version": "2025-11-25" },
      body: ${JSON.stringify(JSON.stringify(message()))},
    });
    const denied = await handler(makeRequest(), {});
    const ready = await handler(makeRequest(), context);
    const body = await ready.json();
    if (denied.status !== 401 || ready.status !== 200 || body.result.structuredContent.missingCount !== 1) throw new Error("unexpected fixture result");
    console.log("guarded-mcp-request-response-ok");
  `;
  const env = process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {};
  const result = spawnSync(process.execPath, ["--no-warnings", "--experimental-loader", loader, "--input-type=module", "--eval", code], {
    cwd: new web.URL("../", import.meta.url), env, encoding: "utf8", timeout: 15000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "guarded-mcp-request-response-ok");
});
