import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractMissingAssignmentsFromHtml } from "../src/schoology.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadFixture(name) {
  const filePath = path.join(__dirname, "fixtures", name);
  return fs.readFileSync(filePath, "utf8");
}

test("extractMissingAssignmentsFromHtml finds missing and excludes exempt", async () => {
  const html = loadFixture("grades.html");
  const items = await extractMissingAssignmentsFromHtml(html);

  assert.equal(items.length, 2);

  const titles = items.map((item) => item.title).sort();
  assert.deepEqual(titles, ["Try It: Body Systems", "U2L8 & U2L9 Cool Downs (9/8)"].sort());

  const tryIt = items.find((item) => item.title.includes("Try It"));
  assert.ok(tryIt);
  assert.equal(tryIt.status, "Missing");
  assert.equal(tryIt.dueDate, "1/06/26 11:59pm");

  const coolDowns = items.find((item) => item.title.includes("Cool Downs"));
  assert.ok(coolDowns);
  assert.equal(coolDowns.status, "Missing");
});
