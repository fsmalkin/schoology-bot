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
  assert.equal(coolDowns.status, "Not Submitted");
});

test("extractMissingAssignmentsFromHtml marks grade-pending submissions as awaiting grade", async () => {
  const html = `
    <div class="gradebook-course">
      <div class="gradebook-course-title">Novice Latin B</div>
      <table>
        <tr class="report-row item-row">
          <td class="item-title"><a href="/assignment/999">January 30th Show What You Know</a></td>
          <td class="grade-column">
            <span class="exception-text">Missing</span>
            <span class="has-dropbox-icon grade-pending-icon">
              <span class="visually-hidden">This student has made a submission that has not been graded.</span>
            </span>
          </td>
        </tr>
      </table>
    </div>
  `;
  const items = await extractMissingAssignmentsFromHtml(html);
  assert.equal(items.length, 1);
  assert.equal(items[0].status, "Submitted, awaiting grade");
  assert.equal(items[0].isMissing, true);
});
