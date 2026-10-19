// Self-contained for a trusted browser host to serialize into its read-only
// document scope. It never navigates, signs in, refreshes or reads saved state.
export function projectCurrentGradebook({
  document, origin, pathname, observedAt, expectedScope,
} = {}) {
  const refuse = () => { throw new Error("Current Schoology source is unavailable."); };
  const normalize = value => String(value || "").replace(/\s+/g, " ").trim();
  const field = (value, limit, required = false) => {
    if (typeof value !== "string" || value.length > limit || value.includes("\0") ||
        (required && !value.trim())) refuse();
    return value.trim();
  };
  if (!document || typeof document.querySelectorAll !== "function" ||
      origin !== "https://bcps.schoology.com" || pathname !== "/grades/grades" ||
      !expectedScope || typeof expectedScope !== "object") refuse();
  const principalId = field(expectedScope.principalId, 128, true);
  const studentId = field(expectedScope.studentId, 80, true);
  const currentTermId = field(expectedScope.currentTermId, 80, true);
  const label = field(expectedScope.currentTermLabel, 80, true);
  if (!/^\d+$/.test(studentId) || /[\r\n]/.test(principalId + currentTermId + label) ||
      typeof observedAt !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(observedAt) ||
      !Number.isFinite(new Date(observedAt).getTime())) refuse();

  // This must be the account menu opened by the trusted source host, not an
  // arbitrary profile link in page content. Missing/ambiguous menus refuse.
  const profileItems = Array.from(document.querySelectorAll('[role="menuitem"]'))
    .filter(item => normalize(item.textContent) === "Your Profile");
  if (profileItems.length !== 1) refuse();
  const item = profileItems[0];
  const profileLink = item.getAttribute("href") ? item : item.querySelector("a[href]");
  let profile;
  try { profile = new URL(profileLink?.getAttribute("href"), origin); } catch { refuse(); }
  if (profile.origin !== origin || profile.username || profile.password ||
      profile.pathname !== "/user/" + studentId + "/info") refuse();

  const courses = Array.from(document.querySelectorAll("div.gradebook-course"));
  if (!courses.length || courses.length > 100) refuse();
  const assignments = [];
  let complete = typeof getComputedStyle === "function";
  let reportRows = 0;
  const visible = node => {
    if (!node || typeof getComputedStyle !== "function" ||
        typeof node.getBoundingClientRect !== "function") return false;
    const style = getComputedStyle(node);
    return style.display !== "none" && style.visibility !== "hidden" &&
      node.getBoundingClientRect().height > 0;
  };
  const statuses = new Map([
    ["missing", "Missing"], ["incomplete", "Incomplete"],
  ]);

  for (const courseNode of courses) {
    const course = field(normalize(courseNode.querySelector(".gradebook-course-title")?.textContent)
      .replace(/Course$/i, "").trim(), 160, true);
    const rows = Array.from(courseNode.querySelectorAll("tr.report-row[data-id]"));
    reportRows += rows.length;
    if (reportRows > 10000) refuse();
    const byId = new Map();
    for (const row of rows) {
      const id = field(row.getAttribute("data-id"), 256, true);
      if (byId.has(id)) refuse();
      byId.set(id, row);
    }
    const active = rows.filter(row => row.classList.contains("period-row") &&
      !row.classList.contains("childrenCollapsed"));
    if (active.length !== 1 || active[0].getAttribute("data-id") !== currentTermId ||
        normalize(active[0].querySelector(".title-column")?.textContent)
          .split("Grading Period")[0].trim() !== label) refuse();
    if (!visible(courseNode.querySelector(".gradebook-course-grades"))) complete = false;

    for (const row of rows.filter(node => node.classList.contains("item-row"))) {
      let parent = row;
      const visited = new Set();
      while (parent && !parent.classList.contains("period-row")) {
        const id = parent.getAttribute("data-id");
        if (visited.has(id) || visited.size >= 128) refuse();
        visited.add(id);
        parent = byId.get(parent.getAttribute("data-parent-id"));
      }
      if (!parent) refuse();
      if (parent.getAttribute("data-id") !== currentTermId) continue;
      if (!visible(row)) complete = false;
      const title = field(normalize(row.querySelector(".title-column .title")?.textContent), 400, true);
      const dueDate = field(normalize(row.querySelector(".title-column .due-date")?.textContent)
        .replace(/^Due:?\s*/i, ""), 100);
      const grade = row.querySelector("td.grade-column");
      // Read only official exception/submission markers, never grade-column
      // text, numeric scores, teacher comments or full assignment row text.
      const exception = field(normalize(grade?.querySelector(".exception-text")?.textContent), 160);
      const submission = normalize(grade?.querySelector(
        ".dropbox-icon-inline-image-wrapper .visually-hidden, .has-dropbox-icon.grade-pending-icon .visually-hidden",
      )?.textContent);
      // The accessible source label establishes submission. Color or an icon
      // class alone does not distinguish an unsubmitted draft or missing work.
      const awaitingGrade = /^(?:this student has made a )?submission that has not been graded[.!]?$/i.test(submission);
      const completedSubmission = /this student has completed assignment submission/i.test(submission);
      const submittedLabel = /^assignment submitted[.!]?$/i.test(submission);
      const unsubmittedDraft = /^draft[,:]? not submitted[.!]?$/i.test(submission);
      let status = "Not marked missing";
      if (exception) {
        status = statuses.get(exception.toLowerCase());
        if (!status) refuse();
      }
      const isMissing = ["Missing", "Incomplete"].includes(status);
      if (awaitingGrade) status = "Submitted, awaiting grade" + (isMissing ? ` (Schoology also marks ${status})` : "");
      else if (completedSubmission || submittedLabel) status = "Submitted (grading status unknown" + (isMissing ? `; Schoology also marks ${status}` : "") + ")";
      else if (unsubmittedDraft) status = isMissing ? `${status} (draft not submitted)` : "Draft (not submitted)";
      const anchor = row.querySelector(".title-column a[href]");
      let url = "";
      if (anchor) {
        try {
          const target = new URL(anchor.getAttribute("href"), origin);
          if (target.protocol === "https:" && target.origin === origin &&
              !target.username && !target.password) {
            target.search = ""; target.hash = ""; url = target.href;
          }
        } catch {}
      }
      if (url.length > 2048) refuse();
      assignments.push({ course, title, dueDate, status, isMissing, url });
      if (assignments.length > 1000) refuse();
    }
  }
  for (const node of document.querySelectorAll('[rel="next"], .pager, .pagination, [aria-busy="true"], .loading')) {
    if (visible(node)) complete = false;
  }
  const snapshot = {
    format: "schoology-current-assignments/v1", sourceOrigin: origin,
    observedAt, complete, assignments,
  };
  // Safe UTF-8 upper bound using only plain ECMAScript. Browser read scopes
  // need not supply TextEncoder; never relabel or regenerate observation time.
  if (JSON.stringify(snapshot).length * 3 > 1024 * 1024) refuse();
  return {
    format: "schoology-qualified-current-term/v1",
    subjectVerified: true, currentTermVerified: true,
    currentTerm: { id: currentTermId, label },
    sourceScope: { principalId, studentId, currentTermId },
    snapshot,
  };
}
