import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { buildCurrentSummary } from "../src/current_summary.js";

const fixture = JSON.parse(await readFile(new URL("./fixtures/current-summary.json", import.meta.url), "utf8"));
const NOW = "2026-10-12T00:05:00Z";
const cli = fileURLToPath(new URL("../src/current_summary_cli.js", import.meta.url));
const loader = new URL("./helpers/current_summary_no_services_loader.mjs", import.meta.url).href;
function snapshot() { return structuredClone(fixture); }
function cliEnvironment(extra = {}) {
  const env = {};
  for (const name of ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "windir", "COMSPEC", "TEMP", "TMP"]) {
    if (process.env[name]) env[name] = process.env[name];
  }
  return { ...env, ...extra };
}
function runCli(args, input, extra = {}, entry = cli) {
  return spawnSync(process.execPath, ["--experimental-loader", loader, entry, ...args], {
    input: input === undefined ? undefined : JSON.stringify(input),
    encoding: "utf8", env: cliEnvironment(extra), timeout: 10000,
  });
}

test("current report uses current missing flags, excludes submitted work and discards old annotations", () => {
  const data = snapshot();
  Object.assign(data.assignments[0], { manualStatus: "Excused (doesn't count)", autoIgnored: true, notes: ["old private note"] });
  data.reminders = [{ title: "old reminder" }];
  const result = buildCurrentSummary(data, { now: NOW });
  assert.equal(result.missing.length, 1);
  assert.equal(result.submittedAwaitingGrade, 1);
  assert.match(result.summaryText, /Example equations/);
  assert.doesNotMatch(result.summaryText, /Example lab|old private note|old reminder|Excused/);
  assert.match(result.summaryText, /Saved exceptions, notes and reminder history are not included/);
  assert.equal(result.missing[0].url, "https://example.schoology.com/assignment/1001");
});

test("completed submission with unknown grading is not counted as confirmed awaiting grade", () => {
  const data=snapshot();
  data.assignments.push({...data.assignments[0],title:"Completed source submission",url:"https://example.schoology.com/assignment/1003",status:"Submitted (grading status unknown)",isMissing:false});
  const result=buildCurrentSummary(data,{now:NOW});
  assert.equal(result.submittedAwaitingGrade,1);
  assert.equal(result.submittedGradingUnknown,1);
  assert.match(result.summaryText,/Submitted work: 2/);
  assert.match(result.summaryText,/Awaiting grade: 1\. Submission confirmed, grading status unknown: 1/);
});

test("exempt submitted work is separate from both awaiting-grade and grading-unknown work",()=>{
  const data=snapshot();data.assignments.push({...data.assignments[0],title:"Excused source work",url:"https://example.schoology.com/assignment/1004",status:"Submitted (Exempt; ungraded marker)",isMissing:false});
  const result=buildCurrentSummary(data,{now:NOW});
  assert.equal(result.submittedAwaitingGrade,1);assert.equal(result.submittedGradingUnknown,0);
  assert.equal(result.exempt,1);assert.equal(result.submittedExempt,1);
  assert.match(result.summaryText,/Submitted work: 2/);assert.match(result.summaryText,/Exempt: 1 \(excused/);
});

test("complete and partial empty snapshots cannot both claim a verified empty current list", () => {
  const data = snapshot(); data.assignments = [];
  assert.match(buildCurrentSummary(data, { now: NOW }).summaryText, /No missing assignments in this complete current Schoology snapshot/);
  data.complete = false;
  const text = buildCurrentSummary(data, { now: NOW }).summaryText;
  assert.match(text, /Partial Schoology view/);
  assert.match(text, /coverage is incomplete/);
  assert.doesNotMatch(text, /Nothing to do right now|No missing assignments in this complete/);
});

test("saved state, stale snapshots, future timestamps and missing coverage are rejected", () => {
  assert.throws(() => buildCurrentSummary({ assignments: {}, lastScrapeAt: NOW }), /explicit current Schoology snapshot/);
  const data = snapshot();
  assert.throws(() => buildCurrentSummary(data, { now: "2026-10-12T00:16:00Z" }), /older than 15 minutes/);
  assert.throws(() => buildCurrentSummary(data, { now: "2026-10-11T23:58:00Z" }), /in the future/);
  delete data.complete;
  assert.throws(() => buildCurrentSummary(data, { now: NOW }), /coverage is complete/);
});

test("bad current row shapes, source origins and timezones fail explicitly", () => {
  const data = snapshot(); delete data.assignments[0].isMissing;
  assert.throws(() => buildCurrentSummary(data, { now: NOW }), /explicit missing status/);
  assert.throws(() => buildCurrentSummary({ ...snapshot(), sourceOrigin: "https://schoology.com.example.org" }, { now: NOW }), /Schoology HTTPS origin/);
  assert.throws(() => buildCurrentSummary(snapshot(), { now: NOW, timeZone: "invalid-zone" }), /valid report timezone/);
});

test("assignment links cannot carry external or credential/session URLs", () => {
  const data = snapshot(); data.assignments[0].url = "https://example.schoology.com/assignment/1001?token=not-a-real-secret#section";
  assert.equal(buildCurrentSummary(data, { now: NOW }).missing[0].url, "https://example.schoology.com/assignment/1001");
  for (const url of ["javascript:alert(1)", "https://other.example/assignment/1001", "https://user:pass@example.schoology.com/assignment/1001"]) {
    data.assignments[0].url = url;
    assert.equal(buildCurrentSummary(data, { now: NOW }).missing[0].url, "");
  }
});

test("duplicate rows are counted once and conflicting current copies fail", () => {
  const data = snapshot(); data.assignments.push(structuredClone(data.assignments[0]));
  assert.equal(buildCurrentSummary(data, { now: NOW }).missing.length, 1);
  data.assignments[2].isMissing = false;
  assert.throws(() => buildCurrentSummary(data, { now: NOW }), /conflicting copies/);
});

test("actual CLI renders fresh stdin with all database, config and service imports denied", () => {
  const data = snapshot(); data.observedAt = new Date().toISOString();
  const result = runCli(["--stdin"], data, { OPENAI_API_KEY: "dummy-not-a-real-key", TELEGRAM_BOT_TOKEN: "dummy-not-a-real-token", DATA_DIR: "invalid-default-data-path" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Example equations/);
  assert.match(result.stdout, /Missing: 1/);
  assert.doesNotMatch(result.stdout, /dummy-not-a-real|CURRENT-SUMMARY-SERVICE/);
});

test("CLI file input leaves supplied snapshot and neighboring saved state unchanged", async t => {
  const prefix = path.join(os.tmpdir(), "schoology-current-summary-test-");
  const dir = await mkdtemp(prefix);
  t.after(async () => {
    const resolved = path.resolve(dir);
    assert.ok(resolved.startsWith(path.resolve(prefix)) && resolved !== path.resolve(os.tmpdir()));
    await rm(resolved, { recursive: true, force: true });
  });
  const inputPath = path.join(dir, "current.json");
  const savedPath = path.join(dir, "state.json");
  const data = snapshot(); data.observedAt = new Date().toISOString();
  const inputText = JSON.stringify(data); const savedText = '{"syntheticOldHistory":"preserve"}';
  await writeFile(inputPath, inputText); await writeFile(savedPath, savedText);
  const result = runCli(["--snapshot", inputPath], undefined, { DATA_DIR: dir });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(await readFile(inputPath, "utf8"), inputText);
  assert.equal(await readFile(savedPath, "utf8"), savedText);
});

test("CLI never falls back to default state, prints raw malformed input or accepts send flags", () => {
  for (const args of [[], ["--send"], ["--snapshot"]]) {
    const result = runCli(args);
    assert.equal(result.status, 2);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /Usage:/);
  }
  const result = spawnSync(process.execPath, [cli, "--stdin"], { input: "PRIVATE-INVALID-INPUT", encoding: "utf8", env: cliEnvironment(), timeout: 10000 });
  assert.equal(result.status, 2);
  assert.equal(result.stdout, "");
  assert.doesNotMatch(result.stderr, /PRIVATE-INVALID-INPUT/);
});

test("no-services guard control rejects the legacy command before config or database use", () => {
  const legacy = fileURLToPath(new URL("../src/run.js", import.meta.url));
  const result = runCli(["once"], undefined, {}, legacy);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /CURRENT-SUMMARY-SERVICE-IMPORT-BLOCKED/);
});
