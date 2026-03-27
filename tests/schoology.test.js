import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractAssignmentsFromHtml, extractMissingAssignmentsFromHtml } from "../src/schoology.js";

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

test("extractMissingAssignmentsFromHtml falls back to visible row title when no assignment link exists", async () => {
  const html = `
    <div class="gradebook-course">
      <div class="gradebook-course-title">Language Arts GT/AA MS7: Sec 003 A PER02</div>
      <table>
        <tr class="report-row item-row">
          <td class="item-title">
            <div>L3: Figurative Language and Multiple Themes</div>
            <div>Note: This material is not available within Schoology</div>
          </td>
          <td class="due-date">Due 2/11/26</td>
          <td class="grade-column">
            <span class="exception-text">Missing</span>
            <span class="awarded-grade">0</span>
          </td>
          <td class="comment-column">
            <div class="comment">Comment: Missing, present during instruction.</div>
          </td>
        </tr>
      </table>
    </div>
  `;
  const items = await extractMissingAssignmentsFromHtml(html);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "L3: Figurative Language and Multiple Themes");
  assert.equal(items[0].dueDate, "2/11/26");
});

test("extractAssignmentsFromHtml prefers score over missing badge and dedupes by assignment id", async () => {
  const html = loadFixture("grades_conflicts.html");
  const items = await extractAssignmentsFromHtml(html);

  assert.equal(items.length, 2);

  const unit5Rows = items.filter((item) => item.url.endsWith("/assignment/8191759007"));
  assert.equal(unit5Rows.length, 1);
  assert.equal(unit5Rows[0].isMissing, false);
  assert.notEqual(unit5Rows[0].status, "Missing");
  assert.match(unit5Rows[0].score, /\d/);

  const unit6 = items.find((item) => item.url.endsWith("/assignment/8286264016"));
  assert.ok(unit6);
  assert.equal(unit6.status, "Submitted, awaiting grade");
  assert.equal(unit6.isMissing, true);
});

test("extractAssignmentsFromHtml uses detail fallback for ambiguous external-tool-link rows", async () => {
  const listHtml = `
    <div class="gradebook-course">
      <div class="gradebook-course-title">Algebra 1 GT/AA MS7: Sec 004 B PER03</div>
      <table>
        <tr class="report-row item-row">
          <td class="item-title">
            <a href="/assignment/999999">25-26 Algebra 1 Unit 7 MUA</a>
            <span class="type">external-tool-link</span>
          </td>
          <td class="due-date">Due 3/10/26 11:59pm</td>
          <td class="grade-column">
            <span class="exception-text">Missing</span>
          </td>
        </tr>
      </table>
    </div>
  `;
  const detailHtml = loadFixture("assignment-detail-mua.html");
  let fetchCount = 0;

  const items = await extractAssignmentsFromHtml(listHtml, {
    detailFetcher: async (url) => {
      fetchCount += 1;
      assert.equal(url, "https://bcps.schoology.com/assignment/999999");
      return detailHtml;
    },
  });

  assert.equal(fetchCount, 1);
  assert.equal(items.length, 1);
  assert.equal(items[0].status, "Submitted, awaiting grade");
  assert.equal(items[0].isMissing, true);
});

test("extractAssignmentsFromHtml caps detail fallback fetches at 25 rows", async () => {
  const rows = Array.from({ length: 30 }, (_, index) => {
    const id = 900000 + index;
    return `
      <tr class="report-row item-row">
        <td class="item-title">
          <a href="/assignment/${id}">25-26 Algebra 1 Unit ${index + 1} MUA</a>
          <span class="type">external-tool-link</span>
        </td>
        <td class="due-date">Due 3/10/26 11:59pm</td>
        <td class="grade-column">
          <span class="exception-text">Missing</span>
        </td>
      </tr>
    `;
  }).join("");

  const listHtml = `
    <div class="gradebook-course">
      <div class="gradebook-course-title">Algebra 1 GT/AA MS7: Sec 004 B PER03</div>
      <table>${rows}</table>
    </div>
  `;
  const detailHtml = loadFixture("assignment-detail-mua.html");
  let fetchCount = 0;

  const items = await extractAssignmentsFromHtml(listHtml, {
    detailFetcher: async () => {
      fetchCount += 1;
      return detailHtml;
    },
  });

  assert.equal(fetchCount, 25);
  assert.equal(items.length, 30);
  assert.equal(items.slice(0, 25).every((item) => item.status === "Submitted, awaiting grade"), true);
  assert.equal(items.slice(25).every((item) => item.status === "Missing"), true);
});
