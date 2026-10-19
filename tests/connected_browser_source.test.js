import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { connectedBrowserSourceContract, validateConnectedBrowserSource, openConnectedGradesTab } from "../src/connected_browser_source.js";

const config = { browserSourceBrowserId: "3", browserSourceRuntimeModule: path.resolve("fixtures/browser-client.mjs"), principalId: "telegram:-10001", studentProfileId: "123", currentTermId: "456", currentTerm: "MP 1 2026-2027" };
function envelope() {
  const contract = connectedBrowserSourceContract(config);
  return { browserId: "3", sourceTabId: "source-tab", sourceUrl: contract.sourceUrl, readerSha256: contract.readerSha256,
    source: { format: "schoology-qualified-current-term/v1", subjectVerified: true, currentTermVerified: true,
      currentTerm: { id: "456", label: config.currentTerm }, sourceScope: { principalId: config.principalId, studentId: "123", currentTermId: "456" },
      snapshot: { format: "schoology-current-assignments/v1", sourceOrigin: "https://bcps.schoology.com", observedAt: new Date().toISOString(), complete: true,
        assignments: [{ course: "Fixture course", title: "Fixture assignment", dueDate: "2026-10-19", status: "Missing", isMissing: true, url: "https://bcps.schoology.com/assignment/789" }] } } };
}

test("existing browser contract contains the original projection and only explicit scope", () => {
  const contract = connectedBrowserSourceContract({ ...config, password: "PRIVATE_FIXTURE_VALUE", browserProfileDirectory: "/private/profile" });
  assert.equal(contract.browserId, "3");
  assert.match(contract.captureCode, /captureConnectedBrowserSource/);
  assert.match(contract.captureCode, /"readerSha256":"[0-9a-f]{64}"/);
  assert.doesNotMatch(JSON.stringify(contract), /PRIVATE_FIXTURE_VALUE|private\/profile|launchPersistentContext/);
  assert.throws(() => connectedBrowserSourceContract({ ...config, browserSourceBrowserId: "" }));
  const value = envelope();
  assert.equal(validateConnectedBrowserSource(config, value).source, value.source);
});

for (const [name, patch] of [
  ["different browser", v => v.browserId = "4"], ["different reader", v => v.readerSha256 = "0".repeat(64)],
  ["different source URL", v => v.sourceUrl += "?other=1"], ["missing tab", v => v.sourceTabId = ""],
  ["different subject", v => v.source.sourceScope.studentId = "999"], ["different caller", v => v.source.sourceScope.principalId = "other"],
  ["different term", v => v.source.currentTerm.id = "999"], ["unverified subject", v => v.source.subjectVerified = false],
  ["incomplete source", v => v.source.snapshot.complete = false], ["old source", v => v.source.snapshot.observedAt = "2000-01-01T00:00:00Z"],
  ["invented freshness", v => v.source.snapshot.observedAt = new Date(Date.now() + 60000).toISOString()],
  ["missing timezone", v => v.source.snapshot.observedAt = "2026-10-18T20:00:00"],
  ["grade field", v => v.source.snapshot.assignments[0].score = "100"],
  ["contradictory status", v => v.source.snapshot.assignments[0].isMissing = false],
  ["unrelated link", v => v.source.snapshot.assignments[0].url = "https://example.com/assignment/789"],
  ["extra source data", v => v.source.messages = []],
]) test(`connected source refuses ${name}`, () => {
  const value = envelope(); patch(value);
  assert.throws(() => validateConnectedBrowserSource(config, value));
});

test("unlinked assignments and an explicit date-only due date stay unchanged", () => {
  const value = envelope(); value.source.snapshot.assignments[0].url = "";
  assert.equal(validateConnectedBrowserSource(config, value).source.snapshot.assignments[0].dueDate, "2026-10-19");
});

test("duplicate official tabs use the exact bound tab or a stable owned tab, with one reload", async () => {
  const calls=[];
  const tab=id=>({id,reload:async()=>calls.push(`reload:${id}`),goto:async url=>calls.push(`goto:${url}`)});
  const browser={tabs:{list:async()=>[{id:"b",url:envelope().sourceUrl},{id:"a",url:envelope().sourceUrl}],get:async id=>tab(id),new:async()=>{calls.push("new");return tab("new")}}};
  assert.equal((await openConnectedGradesTab(browser,"b")).id,"b");
  assert.deepEqual(calls,["reload:b"]);
  calls.length=0;
  assert.equal((await openConnectedGradesTab(browser)).id,"a");
  assert.deepEqual(calls,["reload:a"]);
  calls.length=0;
  await assert.rejects(openConnectedGradesTab(browser,"missing"),/Bound task-owned/);
  assert.deepEqual(calls,[]);
  browser.tabs.list=async()=>[];
  assert.equal((await openConnectedGradesTab(browser)).id,"new");
  assert.deepEqual(calls,["new",`goto:${envelope().sourceUrl}`]);
});
