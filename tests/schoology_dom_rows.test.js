import test from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { spawnSync } from "node:child_process";
import { gradebookDocument } from "./helpers/gradebook_dom_fixture.js";
import { readGradebookRows, projectGradebookAssignmentFields, GradebookProjectionError } from "../src/schoology_dom_rows.js";
import { createCurrentTermMcpHandler } from "../plugins/schoology-current-term/mcp_handler.js";

const ORIGIN = "https://bcps.schoology.com";
const PRIVATE = "fixture-private-comment-grade-or-session";
const web = Object.freeze({
  URL: globalThis.URL, Request: globalThis.Request, Response: globalThis.Response, Headers: globalThis.Headers,
  TextEncoder: globalThis.TextEncoder, TextDecoder: globalThis.TextDecoder,
  Uint8Array: globalThis.Uint8Array, ReadableStream: globalThis.ReadableStream,
});
for (const [name, value] of Object.entries(web)) assert.equal(typeof value, "function", `${name} is required`);

function rawRow(overrides = {}) {
  return { course: "Fixture course", title: "Fixture title", dueDate: "", status: "Missing", isMissing: true, url: "/assignment/100", ...overrides };
}

test("the factored DOM projection retains course/title/due/status and existing internal grade signals", () => {
  const rows = readGradebookRows({ document: gradebookDocument(), origin: ORIGIN });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].course, "Fixture mathematics");
  assert.equal(rows[0].title, "Fixture equations");
  assert.equal(rows[0].dueDate, "Oct 16, 2026");
  assert.equal(rows[0].url, `${ORIGIN}/assignment/100`);
  assert.equal(rows[0].status, "Missing");
  assert.equal(rows[0].isMissing, true);
  assert.equal(rows[0].score, "0 10");
  assert.ok(rows[0].rawText.includes("Missing"));
});

test("actual serialized projection runs without module closures using explicitly supplied DOM and Web globals", () => {
  const document = gradebookDocument({ rows: [{ submitted: true, gradeHint: "Missing" }] });
  const expected = readGradebookRows({ document, origin: ORIGIN });
  const actual = runInNewContext(`(${readGradebookRows.toString()})()`, {
    ...web, document, location: { origin: ORIGIN },
  }, { timeout: 1000 });
  assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected);
});

test("null origins retain the existing BCPS fallback without starting a browser", () => {
  assert.equal(readGradebookRows({ document: gradebookDocument(), origin: "null" })[0].url, `${ORIGIN}/assignment/100`);
  assert.throws(() => readGradebookRows({ document: null, origin: ORIGIN }), /A DOM document is required/);
});

test("submitted icons retain their signal even when the row still contains a missing marker", () => {
  const rows = readGradebookRows({ document: gradebookDocument({ rows: [{ submitted: true, gradeHint: "Missing" }] }), origin: ORIGIN });
  assert.equal(rows[0].submissionText, "Submitted, awaiting grade");
  assert.equal(rows[0].isMissing, true);
  assert.equal(projectGradebookAssignmentFields(rows)[0].status, "Submitted");
});

test("existing exempt and excused row omissions remain in the DOM projection", () => {
  const rows = readGradebookRows({ document: gradebookDocument({ rows: [
    { exception: "Exempt" }, { exception: "Excused", href: "/assignment/101" }, { href: "/assignment/102" },
  ] }), origin: ORIGIN });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].url, `${ORIGIN}/assignment/102`);
});

test("incomplete and unmarked rows produce canonical status labels without copying feedback", () => {
  const rows = readGradebookRows({ document: gradebookDocument({ rows: [
    { comment: "Incomplete", href: "/assignment/100" },
    { comment: "", gradeHint: "", href: "/assignment/101" },
  ] }), origin: ORIGIN });
  const projected = projectGradebookAssignmentFields(rows);
  assert.equal(projected[0].status, "Incomplete");
  assert.equal(projected[1].isMissing, false);
  assert.equal(projected[1].status, "Not marked missing");
});

test("field projection emits exactly six fields and leaves frozen source rows unchanged", () => {
  const row = Object.freeze(rawRow({
    score: PRIVATE, gradeText: PRIVATE, rawText: PRIVATE, statusText: PRIVATE,
    comments: PRIVATE, notes: PRIVATE, studentId: PRIVATE, period: PRIVATE, manualStatus: PRIVATE,
    status: PRIVATE,
  }));
  const input = Object.freeze([row]);
  const before = JSON.stringify(input);
  const output = projectGradebookAssignmentFields(input);
  assert.deepEqual(Object.keys(output[0]).sort(), ["course", "dueDate", "isMissing", "status", "title", "url"]);
  assert.equal(output[0].status, "Missing");
  assert.equal(JSON.stringify(output).includes(PRIVATE), false);
  assert.equal(JSON.stringify(input), before);
});

test("raw teacher/comment text alone cannot mark work submitted in the minimal projection", () => {
  const output = projectGradebookAssignmentFields([rawRow({ rawText: `Assignment submitted ${PRIVATE}`, statusText: PRIVATE })]);
  assert.equal(output[0].status, "Missing");
  assert.equal(JSON.stringify(output).includes(PRIVATE), false);
});

test("projection sanitizes same-origin links and rejects external or credential-bearing links", () => {
  const values = [
    `/assignment/1?session=${PRIVATE}#${PRIVATE}`, "https://unrelated.example/assignment/2",
    "https://fixture:credential@bcps.schoology.com/assignment/3", "javascript:fixture()",
  ];
  const output = projectGradebookAssignmentFields(values.map(url => rawRow({ url })));
  assert.deepEqual(output.map(row => row.url), [`${ORIGIN}/assignment/1`, "", "", ""]);
  assert.equal(JSON.stringify(output).includes(PRIVATE), false);
});

test("projection refuses missing flags, ambiguous titles, invalid fields and oversized input with fixed errors", () => {
  const inputs = [
    null, {}, Array.from({ length: 1001 }, () => rawRow()), [null], [rawRow({ isMissing: undefined })],
    [rawRow({ title: "" })], [rawRow({ title: PRIVATE + "\0" })], [rawRow({ title: "x".repeat(401) })],
    [rawRow({ course: 1 })], [rawRow({ dueDate: {} })], [rawRow({ status: "x".repeat(161) })],
  ];
  for (const input of inputs) {
    assert.throws(() => projectGradebookAssignmentFields(input), error => {
      assert.ok(error instanceof GradebookProjectionError);
      assert.equal(error.message.includes(PRIVATE), false);
      return true;
    });
  }
});

test("an empty projection is only an array and invents no complete/current/student/time evidence", () => {
  const output = projectGradebookAssignmentFields(readGradebookRows({ document: gradebookDocument({ rows: [] }), origin: ORIGIN }));
  assert.deepEqual(output, []);
  for (const name of ["format", "subjectVerified", "currentTermVerified", "currentTerm", "sourceScope", "complete", "observedAt"]) {
    assert.equal(Object.hasOwn(output, name), false);
  }
});

test("missing, wrong or ambiguous student labels and mixed-period or incomplete DOM views cannot become a qualified reader", async () => {
  const context = Object.freeze({ server: "fixture" });
  const views = [
    { heading: "Grades" },
    { heading: "Student B | Current", rows: [{ title: PRIVATE }] },
    { heading: "Student A Student B | Current", rows: [{ title: PRIVATE }] },
    { heading: "Student A | Current Past", rows: [
      { title: PRIVATE, period: "Current" }, { title: "Fixture past item", href: "/assignment/101", period: "Past" },
    ] },
    { heading: "Student A | Current | Page 1 of 2", complete: false, rows: [{ title: PRIVATE }] },
  ];
  for (const view of views) {
    const assignments = projectGradebookAssignmentFields(readGradebookRows({ document: gradebookDocument(view), origin: ORIGIN }));
    if (view.rows?.length === 2) assert.equal(assignments.length, 2);
    const handler = createCurrentTermMcpHandler({
      now: () => new Date("2026-10-17T12:05:00Z"),
      authorizeRequest: async trusted => trusted === context ? {
        principalId: "fixture-caller", authorizedScope: { studentId: "student-A", currentTermId: "fixture-current" },
        readCurrentTermSnapshot: async () => ({
          format: "schoology-qualified-current-term/v1", subjectVerified: true, currentTermVerified: true,
          currentTerm: { id: "fixture-current", label: "Fixture current term" },
          snapshot: {
            format: "schoology-current-assignments/v1", sourceOrigin: ORIGIN,
            observedAt: "2026-10-17T12:00:00Z", complete: view.complete ?? true, assignments,
          },
        }),
      } : null,
    });
    const response = await handler(new web.Request("https://fixture.example/mcp", {
      method: "POST", headers: new web.Headers({ Accept: "application/json, text/event-stream", "Content-Type": "application/json", "MCP-Protocol-Version": "2025-11-25" }),
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_current_term_summary", arguments: {} } }),
    }), context);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.result.structuredContent.reason, "unverified_current_scope");
    assert.equal(Object.hasOwn(body.result.structuredContent, "items"), false);
    assert.equal(JSON.stringify(body).includes(PRIVATE), false);
  }
});

test("the projection module imports and runs with browser, file and service imports refused", () => {
  const moduleUrl = new web.URL("../src/schoology_dom_rows.js", import.meta.url).href;
  const loader = new web.URL("./helpers/current_term_summary_no_io_loader.mjs", import.meta.url).href;
  const script = `
    const web = { URL, Request, Response, Headers, TextEncoder, TextDecoder, Uint8Array, ReadableStream };
    for (const value of Object.values(web)) if (typeof value !== "function") throw new Error("Missing Web API");
    const { readGradebookRows, projectGradebookAssignmentFields } = await import(${JSON.stringify(moduleUrl)});
    const rows = readGradebookRows({ document: { querySelectorAll: () => [] }, origin: "https://bcps.schoology.com" });
    if (rows.length !== 0) throw new Error("Unexpected DOM result");
    const result = projectGradebookAssignmentFields([${JSON.stringify(rawRow())}]);
    if (result[0].status !== "Missing" || Object.keys(result[0]).length !== 6) throw new Error("Unexpected projection");
    console.log("guarded-dom-projection-ok");
  `;
  const env = process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {};
  const result = spawnSync(process.execPath, ["--no-warnings", "--experimental-loader", loader, "--input-type=module", "--eval", script], {
    cwd: new web.URL("../", import.meta.url), env, encoding: "utf8", timeout: 15000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "guarded-dom-projection-ok");
});

test("separately scoped synthetic input runs through the real MCP tool after field minimization", async () => {
  const rows = readGradebookRows({ document: gradebookDocument({ rows: [
    { title: "Fixture active", href: `/assignment/100?session=${PRIVATE}`, comment: `Missing ${PRIVATE}` },
    { title: "Fixture submitted", href: "/assignment/101", comment: PRIVATE, gradeHint: "Missing", submitted: true },
    { title: "Fixture incomplete", href: "/assignment/102", comment: "Incomplete" },
  ] }), origin: ORIGIN });
  assert.equal(JSON.stringify(rows).includes(PRIVATE), true);
  const assignments = projectGradebookAssignmentFields(rows);
  const context = Object.freeze({ fixture: "independently-bound-scope" });
  const sourceScope = Object.freeze({ principalId: "fixture-caller", studentId: "student-A", currentTermId: "fixture-current" });
  const handler = createCurrentTermMcpHandler({
    now: () => new Date("2026-10-17T12:05:00Z"),
    authorizeRequest: async trusted => trusted === context ? {
      principalId: sourceScope.principalId,
      authorizedScope: { studentId: sourceScope.studentId, currentTermId: sourceScope.currentTermId },
      readCurrentTermSnapshot: async () => ({
        format: "schoology-qualified-current-term/v1", subjectVerified: true, currentTermVerified: true,
        currentTerm: { id: sourceScope.currentTermId, label: "Fixture current term" }, sourceScope,
        snapshot: { format: "schoology-current-assignments/v1", sourceOrigin: ORIGIN,
          observedAt: "2026-10-17T12:00:00Z", complete: true, assignments },
      }),
    } : null,
  });
  const response = await handler(new web.Request("https://fixture.example/mcp", {
    method: "POST", headers: new web.Headers({ Accept: "application/json, text/event-stream", "Content-Type": "application/json", "MCP-Protocol-Version": "2025-11-25" }),
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_current_term_summary", arguments: {} } }),
  }), context);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.result.structuredContent.status, "ready");
  assert.equal(body.result.structuredContent.missingCount, 2);
  assert.equal(body.result.structuredContent.submittedExcludedCount, 1);
  assert.deepEqual(body.result.structuredContent.items.map(item => item.title), ["Fixture active", "Fixture incomplete"]);
  assert.equal(JSON.stringify(body).includes(PRIVATE), false);
});
