import { getSubmittedSchoologyStatusLabel } from "./statuses.js";

// Self-contained so the existing scraper may serialize this function into a
// page. Reading a document does not establish student, term or coverage scope.
export function readGradebookRows({ document = globalThis.document, origin = globalThis.location?.origin } = {}) {
  if (!document || typeof document.querySelectorAll !== "function") throw new Error("A DOM document is required.");
  const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const stripCommentPrefix = (value) => normalize(value).replace(/^Comment:\s*/i, "");
  const missingPatterns = [
    /missing/i,
    /not completed/i,
    /not submitted/i,
    /no submission/i,
    /not turned in/i,
    /incomplete/i,
    /absent/i,
  ];

  const results = [];
  const courses = Array.from(document.querySelectorAll("div.gradebook-course"));

  for (const courseNode of courses) {
    const courseTitle = courseNode.querySelector(".gradebook-course-title");
    let course = courseTitle ? normalize(courseTitle.textContent) : "";
    course = course.replace(/Course$/i, "").trim();

    const itemRows = Array.from(courseNode.querySelectorAll("tr.report-row.item-row"));
    for (const row of itemRows) {
      const titleCell = row.querySelector("td.item-title, .item-title");
      const titleLink =
        row.querySelector("a[href*='/assignment']") || row.querySelector("a[href]") || null;
      const base = origin && origin !== "null" ? origin : "https://bcps.schoology.com";
      const url = titleLink ? new URL(titleLink.getAttribute("href"), base).toString() : "";

      const dueDate = normalize(row.querySelector(".due-date")?.textContent || "").replace(/^Due\s*/i, "");

      const gradeColumn = row.querySelector("td.grade-column");
      const awardedGrade = normalize(gradeColumn?.querySelector(".awarded-grade")?.textContent || "");
      const maxGrade = normalize(gradeColumn?.querySelector(".max-grade")?.textContent || "");
      const noGrade = normalize(gradeColumn?.querySelector(".no-grade")?.textContent || "");
      const gradeColumnText = normalize(gradeColumn?.textContent || "");
      const fallbackGrade = gradeColumnText;
      const gradeText =
        [awardedGrade, maxGrade].filter(Boolean).join(" ").trim() || noGrade || fallbackGrade;

      const commentText = stripCommentPrefix(
        row.querySelector("td.comment-column .comment")?.textContent || ""
      );

      const exceptionText = normalize(gradeColumn?.querySelector(".exception-text")?.textContent || "");
      if (exceptionText && /exempt|excused/i.test(exceptionText)) {
        continue;
      }

      const submissionHiddenText = normalize(
        gradeColumn?.querySelector(
          ".dropbox-icon-inline-image-wrapper .visually-hidden, .has-dropbox-icon.grade-pending-icon .visually-hidden"
        )?.textContent || ""
      );
      const hasGradePendingIcon =
        Boolean(gradeColumn?.querySelector(".has-dropbox-icon.grade-pending-icon")) ||
        /submission that has not been graded|assignment submitted/i.test(submissionHiddenText);
      const submissionText = hasGradePendingIcon
        ? "Submitted, awaiting grade"
        : submissionHiddenText;
      const statusHints = [commentText, exceptionText, submissionText, gradeColumnText]
        .filter(Boolean)
        .join(" ");

      results.push({
        course,
        title: titleLink ? normalize(titleLink.textContent) : "",
        titleText: normalize(titleCell?.textContent || titleLink?.textContent || ""),
        dueDate,
        status: submissionText || commentText || exceptionText || "Missing",
        score: gradeText,
        url,
        rawText: normalize(row.textContent || ""),
        statusText: normalize(commentText || exceptionText || gradeColumnText || ""),
        submissionText,
        gradeText,
        isMissing: missingPatterns.some((pattern) => pattern.test(statusHints)),
      });
    }
  }

  return results;
}

export class GradebookProjectionError extends Error {}

function field(value, limit, required = false) {
  if (value === undefined && !required) return "";
  if (typeof value !== "string" || value.length > limit || value.includes("\0") || (required && !value.trim())) {
    throw new GradebookProjectionError("Invalid gradebook field.");
  }
  return value.trim();
}

function assignmentUrl(value) {
  try {
    if (!value) return "";
    const url = new URL(value, "https://bcps.schoology.com");
    if (url.protocol !== "https:" || url.origin !== "https://bcps.schoology.com" || url.username || url.password) return "";
    url.search = "";
    url.hash = "";
    return url.href;
  } catch {
    return "";
  }
}

// This is field minimization, not acquisition or a qualified snapshot.
// Do not synthesize identity, term, coverage, observation time or grant flags.
export function projectGradebookAssignmentFields(rows) {
  if (!Array.isArray(rows) || rows.length > 1000) throw new GradebookProjectionError("Invalid gradebook rows.");
  return rows.map(row => {
    if (!row || typeof row !== "object" || Array.isArray(row) || typeof row.isMissing !== "boolean") {
      throw new GradebookProjectionError("Invalid gradebook row.");
    }
    const course = field(row.course, 160, true);
    const title = field(row.title, 400, true);
    const dueDate = field(row.dueDate, 100);
    const status = field(row.status, 160);
    const submissionText = field(row.submissionText, 160);
    const submitted = getSubmittedSchoologyStatusLabel({ status: submissionText || status });
    return {
      course,
      title,
      dueDate,
      status: submitted ? "Submitted" : row.isMissing ? (/^incomplete$/i.test(status) ? "Incomplete" : "Missing") : "Not marked missing",
      isMissing: row.isMissing,
      url: assignmentUrl(field(row.url, 2048)),
    };
  });
}
