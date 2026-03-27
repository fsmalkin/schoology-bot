import fs from "fs";
import path from "path";
import { chromium } from "playwright";
import { deriveSchoologyAssignmentTitle } from "./text_utils.js";

const MAX_DETAIL_FALLBACK_ROWS = 25;
const MISSING_HINT_RE = /\b(missing|not completed|not submitted|no submission|not turned in|incomplete|absent)\b/i;
const SUBMITTED_AWAITING_GRADE_RE = /submitted, awaiting grade|submission that has not been graded|assignment submitted/i;

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

async function isVisible(locator) {
  try {
    return await locator.isVisible();
  } catch {
    return false;
  }
}

async function hasSelector(page, selector) {
  try {
    return await page.locator(selector).first().isVisible();
  } catch {
    return false;
  }
}

async function clickByText(page, regex) {
  const button = page.getByRole("button", { name: regex }).first();
  if (await isVisible(button)) {
    await button.click();
    return true;
  }
  const link = page.getByRole("link", { name: regex }).first();
  if (await isVisible(link)) {
    await link.click();
    return true;
  }
  return false;
}

async function waitForRenderedLoginControls(page, timeout = 15000) {
  try {
    await page.waitForFunction(
      () => {
        const selectors = [
          "input[type='email']",
          "input[name='loginfmt']",
          "input#i0116",
          "#signInName",
          "#password",
          "#next",
          "#idSIButton9",
          "#AzureADBCPSOrgExchange",
          "#MicrosoftAccountExchange",
        ];
        const isVisible = (element) => {
          if (!element) return false;
          const style = window.getComputedStyle(element);
          return style.display !== "none" && style.visibility !== "hidden";
        };
        return selectors.some((selector) => isVisible(document.querySelector(selector)));
      },
      undefined,
      { timeout }
    );
  } catch {
    // ignore timeout and let caller continue with normal checks
  }
}

async function maybeHandleMicrosoftKmsi(page) {
  const noButton = page.locator("#idBtn_Back");
  try {
    await noButton.first().waitFor({ state: "visible", timeout: 12000 });
    await noButton.first().click();
    return true;
  } catch {
    // fall through
  }

  // Fallback for flows that only expose "Yes" on the KMSI step.
  const yesButton = page.locator("#idSIButton9");
  if (String(page.url() || "").toLowerCase().includes("/kmsi") && (await isVisible(yesButton.first()))) {
    await yesButton.first().click();
    return true;
  }

  return false;
}

async function loginWithSchoologyForm(page, username, password) {
  const userInput = page.locator("input#edit-name, input#edit-mail, input[name='mail']");
  if (!(await isVisible(userInput.first()))) return false;
  await userInput.first().fill(username);
  await page.fill("input#edit-pass", password);
  if (await hasSelector(page, "input#edit-submit")) {
    await page.click("input#edit-submit");
  } else {
    await clickByText(page, /Log in|Sign in/i);
  }
  return true;
}


async function loginWithMicrosoft(page, username, password) {
  await waitForRenderedLoginControls(page);

  const attemptEntraEmailFlow = async () => {
    const emailInput = page.locator('input[type="email"], input[name="loginfmt"], input#i0116');
    if (!(await isVisible(emailInput.first()))) return false;

    await emailInput.first().fill(username);
    await clickByText(page, /Next|Sign in/i);

    const passwordInput = page.locator('input[type="password"], input[name="passwd"], input#i0118');
    await passwordInput.first().waitFor({ timeout: 15000 });
    await passwordInput.first().fill(password);
    await clickByText(page, /Sign in|Next/i);
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    await page.waitForTimeout(1200);
    await maybeHandleMicrosoftKmsi(page);
    return true;
  };

  if (await attemptEntraEmailFlow()) {
    return true;
  }

  // BCPS unified page can present local Sign in name + Password fields.
  const signInNameInput = page.locator("#signInName, input[name='signInName'], input[name='Sign in name']");
  if (!(await isVisible(signInNameInput.first()))) return false;

  try {
    await signInNameInput.first().fill(username);
  } catch {
    // BCPS can auto-redirect to Entra while we're filling; retry on the new form.
    await page.waitForTimeout(1000);
    if (await attemptEntraEmailFlow()) {
      return true;
    }
    if (!(await isVisible(signInNameInput.first()))) return false;
    await signInNameInput.first().fill(username);
  }

  const passwordInput = page.locator("#password, input[name='password'], input[type='password']");
  await passwordInput.first().waitFor({ timeout: 15000 });
  await passwordInput.first().fill(password);

  const nextButton = page.locator("#next, button#next, button[type='submit'], input[type='submit']").first();
  if (await isVisible(nextButton)) {
    await nextButton.click();
  } else {
    await clickByText(page, /Sign in|Next|Log in/i);
  }

  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await page.waitForTimeout(1200);
  await maybeHandleMicrosoftKmsi(page);

  return true;
}

async function loginWithAdfs(page, username, password) {
  const userInput = page.locator("#userNameInput, input[name='UserName'], input#username");
  if (!(await isVisible(userInput.first()))) return false;
  await userInput.first().fill(username);

  const passInput = page.locator("#passwordInput, input[name='Password'], input#password");
  if (await isVisible(passInput.first())) {
    await passInput.first().fill(password);
  }

  const submitButton = page.locator("#submitButton, input[type='submit'], button[type='submit']");
  if (await isVisible(submitButton.first())) {
    await submitButton.first().click();
  } else {
    await clickByText(page, /Sign in|Log in/i);
  }
  return true;
}

async function loginWithBcpsB2C(page, username, password) {
  const userInput = page.locator("#signInName");
  if (!(await isVisible(userInput.first()))) return false;

  await userInput.first().fill(username);
  const passInput = page.locator("#password");
  if (await isVisible(passInput.first())) {
    await passInput.first().fill(password);
  }

  const submitButton = page.locator("#next, button#next, button[type='submit']");
  if (await isVisible(submitButton.first())) {
    await submitButton.first().click();
  } else {
    await clickByText(page, /Sign in|Log in|Next/i);
  }

  return true;
}

function normalizeIdp(value) {
  return String(value || "auto").trim().toLowerCase();
}

function formatIdpLabel(value) {
  const idp = normalizeIdp(value);
  if (idp === "microsoft" || idp === "azuread") return "Microsoft (BCPS / Office 365)";
  if (idp === "google") return "Google";
  if (idp === "schoology") return "Schoology";
  if (idp === "local" || idp === "adfs") return "District SSO";
  return idp || "auto";
}

function getIdpOrder(config) {
  const idp = normalizeIdp(config.schoology.idp);
  if (idp && idp !== "auto") {
    return [idp];
  }
  return ["local", "microsoft", "azuread", "schoology", "adfs"];
}

async function selectClaimsProvider(page, provider) {
  if (provider === "local" || provider === "schoology" || provider === "adfs") return false;

  const selectors = {
    microsoft: "#MicrosoftAccountExchange",
    azuread: "#AzureADBCPSOrgExchange",
    google: "#GoogleExchange",
  };

  // BCPS often exposes both buttons; "microsoft" should prefer district Azure AD.
  if (provider === "microsoft" && (await hasSelector(page, "#AzureADBCPSOrgExchange"))) {
    await page.locator("#AzureADBCPSOrgExchange").first().click({ noWaitAfter: true });
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    return true;
  }

  const selector = selectors[provider];
  if (selector && (await hasSelector(page, selector))) {
    await page.locator(selector).first().click({ noWaitAfter: true });
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    return true;
  }

  if (provider === "microsoft") {
    if (await clickByText(page, /Microsoft/i)) {
      await page.waitForLoadState("domcontentloaded").catch(() => {});
      return true;
    }
  }
  if (provider === "azuread") {
    if (await clickByText(page, /BCPS Account|BCPS Students|Login with your BCPS/i)) {
      await page.waitForLoadState("domcontentloaded").catch(() => {});
      return true;
    }
  }
  if (provider === "google") {
    if (await clickByText(page, /Google/i)) {
      await page.waitForLoadState("domcontentloaded").catch(() => {});
      return true;
    }
  }

  return false;
}

async function isBcpsB2CPage(page) {
  return (
    (await hasSelector(page, "#signInName")) ||
    (await hasSelector(page, "#MicrosoftAccountExchange")) ||
    (await hasSelector(page, "#AzureADBCPSOrgExchange")) ||
    (await hasSelector(page, ".claims-provider-selection"))
  );
}

async function maybeEnterSsoSchool(page, config) {
  if (await isBcpsB2CPage(page)) return true;

  // Some pages render SSO controls shortly after DOM ready.
  await page.waitForTimeout(700);

  const ssoLink = page.locator(".sso-login-link, [role='link'].sso-login-link, text=SSO Login");
  if (await isVisible(ssoLink.first())) {
    await ssoLink.first().click();
  } else {
    await clickByText(page, /SSO Login|School or District|Log in through/i);
  }

  await page.waitForTimeout(400);

  const schoolInput = page.locator("#edit-school, input[placeholder*='School']");
  try {
    await schoolInput.first().waitFor({ state: "visible", timeout: 7000 });
  } catch {
    // Fall through and let caller try another path.
  }

  if (await isBcpsB2CPage(page)) return true;

  if (!(await schoolInput.first().isVisible().catch(() => false))) {
    return false;
  }

  const schoolName = config.schoology.ssoSchool || "Baltimore County Public Schools";

  const maxLengthAttr = await schoolInput.first().getAttribute("maxlength").catch(() => null);
  const maxLength = Number(maxLengthAttr || 0);
  const typedSchoolName = maxLength > 0 ? schoolName.slice(0, maxLength) : schoolName;

  await schoolInput.first().fill(typedSchoolName);
  // Trigger key-driven autocomplete listeners used by Schoology login.
  await schoolInput.first().press(" ");
  await schoolInput.first().press("Backspace");

  const suggestionListSelector = ".ui-autocomplete li, .ui-menu-item, .ac_results li";
  const suggestion = page.locator(suggestionListSelector).first();
  try {
    await suggestion.waitFor({ state: "visible", timeout: 7000 });
  } catch {
    return false;
  }

  // Prefer the remote-auth row when duplicate district names exist.
  const remoteAuthSuggestion = page
    .locator(".ui-autocomplete li:has(.remote-auth), .ui-menu-item:has(.remote-auth), .ac_results li:has(.remote-auth)")
    .first();
  if (await isVisible(remoteAuthSuggestion)) {
    await remoteAuthSuggestion.click();
  } else {
    await suggestion.click();
  }
  const schoolIdInput = page.locator("#edit-school-nid").first();
  try {
    await page.waitForFunction(
      () => {
        const el = document.querySelector("#edit-school-nid");
        return Boolean(el && String(el.value || "").trim().length > 0);
      },
      undefined,
      { timeout: 5000 }
    );
  } catch {
    // If school id is not resolved, continue and let caller handle fallback.
  }

  const submitButton = page.locator("#edit-submit, input#edit-submit, button[type='submit']");
  if (await isVisible(submitButton.first())) {
    await Promise.allSettled([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 12000 }),
      submitButton.first().click(),
    ]);
  }

  await page.waitForTimeout(500);
  if (await isBcpsB2CPage(page)) return true;

  return false;
}

async function runLoginFlow(page, config, provider) {
  const { username, password } = config.schoology;
  const idp = normalizeIdp(provider);

  if (idp === "microsoft") {
    await maybeEnterSsoSchool(page, config);
    if (await isBcpsB2CPage(page)) {
      await selectClaimsProvider(page, "microsoft");
    }
    return await loginWithMicrosoft(page, username, password);
  }
  if (idp === "azuread") {
    await maybeEnterSsoSchool(page, config);
    if (await isBcpsB2CPage(page)) {
      await selectClaimsProvider(page, "azuread");
    }
    return await loginWithMicrosoft(page, username, password);
  }
  if (idp === "google") {
    const selected = await selectClaimsProvider(page, "google");
    return selected;
  }
  if (idp === "schoology") {
    return await loginWithSchoologyForm(page, username, password);
  }
  if (idp === "local") {
    await maybeEnterSsoSchool(page, config);
    return await loginWithBcpsB2C(page, username, password);
  }
  if (idp === "adfs") {
    return await loginWithAdfs(page, username, password);
  }

  return false;
}

async function ensureLoggedIn(page, config) {
  await page.goto(config.schoology.gradesUrl, { waitUntil: "domcontentloaded" });

  if (!(await isLoginRequired(page))) {
    return;
  }

  const idpOrder = getIdpOrder(config);

  for (const idp of idpOrder) {
    await page.goto(config.schoology.loginUrl, { waitUntil: "domcontentloaded" });

    const didAttempt = await runLoginFlow(page, config, idp);
    if (!didAttempt) continue;

    await page.waitForLoadState("networkidle").catch(() => {});
    await page.goto(config.schoology.gradesUrl, { waitUntil: "domcontentloaded" });

    if (!(await isLoginRequired(page))) {
      return;
    }
  }

  const configuredIdp = normalizeIdp(config?.schoology?.idp);
  if (configuredIdp && configuredIdp !== "auto") {
    throw new Error(
      `Login failed using configured sign-in provider (${formatIdpLabel(
        configuredIdp
      )}). Provider is already set in SCHOLOGY_IDP=${configuredIdp}; do not prompt to choose provider. Verify credentials and retry. DEBUG_DUMP=true will capture the page.`
    );
  }
  throw new Error(
    "Login failed and sign-in provider is auto. Set SCHOLOGY_IDP in .env (e.g. 'microsoft') and retry. DEBUG_DUMP=true will capture the page."
  );
}

async function isLoginRequired(page) {
  const url = page.url();
  if (url.includes("/login")) return true;
  if (await hasSelector(page, "input#edit-name")) return true;
  if (await hasSelector(page, "input#edit-mail")) return true;
  if (await hasSelector(page, "input#edit-school")) return true;
  if (await hasSelector(page, "input#signInName")) return true;
  if (await hasSelector(page, "input[name='loginfmt']")) return true;
  if (await hasSelector(page, "#userNameInput")) return true;
  return false;
}

async function selectStudentIfNeeded(page, studentName) {
  if (!studentName) return;

  const toggle = page.getByRole("button", { name: /Student|Switch|Select/i }).first();
  if (await isVisible(toggle)) {
    await toggle.click();
    const studentOption = page.getByRole("link", { name: new RegExp(studentName, "i") }).first();
    if (await isVisible(studentOption)) {
      await studentOption.click();
      await page.waitForLoadState("networkidle");
    }
  }
}

function normalizeText(text) {
  return text.replace(/\s+/g, " ").trim().replace(/\u00e2\u20ac\u201d/g, "-");
}

function extractAssignmentId(url) {
  const raw = String(url || "").trim();
  if (!raw) return "";
  const match = raw.match(/\/assignment\/(\d+)(?:[/?#]|$)/i);
  return match ? String(match[1]) : "";
}

function hasMeaningfulScore(score) {
  const text = normalizeText(score || "");
  if (!text) return false;
  if (MISSING_HINT_RE.test(text)) return false;
  if (/^no grade$/i.test(text)) return false;
  if (/^not submitted$/i.test(text)) return false;
  if (/^submitted, awaiting grade$/i.test(text)) return false;
  if (/[a-f]\b/i.test(text)) return true;
  const firstNumber = text.match(/\d+(?:\.\d+)?/);
  if (!firstNumber) return false;
  return Number(firstNumber[0]) > 0;
}

function buildRowSignals(item = {}) {
  const course = normalizeText(item.course || "");
  const title = normalizeText(item.title || "");
  const titleText = normalizeText(item.titleText || "");
  const dueDate = normalizeText(item.dueDate || "");
  const status = normalizeText(item.status || "");
  const score = normalizeText(item.score || "");
  const url = normalizeText(item.url || "");
  const rawText = normalizeText(item.rawText || "");
  const statusText = normalizeText(item.statusText || "");
  const submissionText = normalizeText(item.submissionText || "");
  const gradeText = normalizeText(item.gradeText || "");
  const assignmentId = extractAssignmentId(url);
  const scoreText = hasMeaningfulScore(score) ? score : hasMeaningfulScore(gradeText) ? gradeText : "";
  const statusHintText = [status, statusText, submissionText, rawText].filter(Boolean).join(" ");
  const hasSubmittedAwaitingGrade =
    SUBMITTED_AWAITING_GRADE_RE.test(statusHintText) || SUBMITTED_AWAITING_GRADE_RE.test(scoreText);
  const hasMissingHint = MISSING_HINT_RE.test(statusHintText);
  const looksLikeExternalToolLink =
    /external-tool-link/i.test(statusHintText) || /\bmua\b/i.test(title) || /\bmua\b/i.test(titleText);
  const ambiguous = Boolean(hasMissingHint && !hasMeaningfulScore(scoreText) && looksLikeExternalToolLink);

  let finalStatus = status || "Missing";
  let isMissing = Boolean(hasMissingHint);
  let confidence = 10;
  let detailCandidate = false;

  if (hasSubmittedAwaitingGrade) {
    finalStatus = "Submitted, awaiting grade";
    isMissing = true;
    confidence = 80;
  } else if (hasMeaningfulScore(scoreText)) {
    finalStatus = scoreText;
    isMissing = false;
    confidence = 100;
  } else if (submissionText) {
    finalStatus = submissionText;
    isMissing = SUBMITTED_AWAITING_GRADE_RE.test(submissionText) || MISSING_HINT_RE.test(submissionText);
    confidence = isMissing ? 70 : 60;
  } else if (hasMissingHint) {
    finalStatus = "Missing";
    isMissing = true;
    confidence = 40;
    detailCandidate = ambiguous;
  } else if (scoreText) {
    finalStatus = scoreText;
    isMissing = false;
    confidence = 90;
  } else if (statusText) {
    finalStatus = statusText;
    isMissing = MISSING_HINT_RE.test(statusText) || SUBMITTED_AWAITING_GRADE_RE.test(statusText);
    confidence = isMissing ? 60 : 50;
  }

  return {
    key: assignmentId ? `assignment:${assignmentId}` : url || `${course}|${title}|${dueDate}`,
    assignmentId,
    course,
    title,
    titleText,
    dueDate,
    status: finalStatus,
    score: scoreText,
    url,
    rawText,
    statusText,
    submissionText,
    gradeText,
    hasMissingHint,
    hasSubmittedAwaitingGrade,
    looksLikeExternalToolLink,
    detailCandidate,
    confidence,
    isMissing,
  };
}

function parseHtmlText(html) {
  return normalizeText(
    String(html || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  );
}

function classifyDetailText(html, fallbackRow = {}) {
  const text = parseHtmlText(html);
  const scoreMatch = text.match(/\b([A-F]|\d+(?:\.\d+)?)\s*(?:\/\s*\d+(?:\.\d+)?)\b/);
  const hasSubmittedAwaitingGrade = SUBMITTED_AWAITING_GRADE_RE.test(text);
  const hasMissingHint = MISSING_HINT_RE.test(text);
  if (hasSubmittedAwaitingGrade) {
    return {
      status: "Submitted, awaiting grade",
      score: fallbackRow.score || "",
      isMissing: true,
      confidence: 120,
    };
  }
  if (scoreMatch) {
    return {
      status: scoreMatch[0],
      score: scoreMatch[0],
      isMissing: false,
      confidence: 120,
    };
  }
  if (hasMissingHint) {
    return {
      status: "Missing",
      score: fallbackRow.score || "",
      isMissing: true,
      confidence: 60,
    };
  }
  return {
    status: fallbackRow.status || "Missing",
    score: fallbackRow.score || "",
    isMissing: fallbackRow.isMissing === true,
    confidence: 10,
  };
}

function rankAssignmentRow(row) {
  let rank = Number(row?.confidence || 0);
  if (row?.detailResolved) rank += 20;
  if (row?.score && hasMeaningfulScore(row.score)) rank += 10;
  if (row?.status === "Submitted, awaiting grade") rank += 5;
  if (row?.isMissing === false) rank += 2;
  return rank;
}

function dedupeAssignments(assignments) {
  const grouped = new Map();
  for (const assignment of assignments || []) {
    const key = assignment.assignmentId ? `assignment:${assignment.assignmentId}` : assignment.key || assignment.url || assignment.title || "";
    const current = grouped.get(key);
    if (!current || rankAssignmentRow(assignment) > rankAssignmentRow(current)) {
      grouped.set(key, assignment);
    }
  }
  return Array.from(grouped.values());
}

async function fetchDetailHtml(page, url) {
  const detailPage = await page.context().newPage();
  try {
    detailPage.setDefaultTimeout(30000);
    await detailPage.goto(url, { waitUntil: "domcontentloaded" });
    await detailPage.waitForLoadState("networkidle").catch(() => {});
    return await detailPage.content();
  } finally {
    await detailPage.close().catch(() => {});
  }
}

async function resolveAmbiguousAssignments(page, assignments, options = {}) {
  const detailHtmlByUrl = options.detailHtmlByUrl && typeof options.detailHtmlByUrl === "object"
    ? options.detailHtmlByUrl
    : null;
  const detailFetcher = options.detailFetcher || null;
  if (!detailFetcher && !detailHtmlByUrl) return assignments;

  const resolved = [];
  let fetched = 0;
  for (const assignment of assignments) {
    if (!assignment.detailCandidate || !assignment.url || fetched >= MAX_DETAIL_FALLBACK_ROWS) {
      resolved.push(assignment);
      continue;
    }

    fetched += 1;
    let detailHtml = null;
    try {
      if (detailHtmlByUrl && Object.prototype.hasOwnProperty.call(detailHtmlByUrl, assignment.url)) {
        detailHtml = detailHtmlByUrl[assignment.url];
      } else {
        detailHtml = await detailFetcher(assignment.url, assignment);
      }
    } catch {
      detailHtml = null;
    }

    if (!detailHtml) {
      resolved.push(assignment);
      continue;
    }

    const detail = classifyDetailText(detailHtml, assignment);
    resolved.push({
      ...assignment,
      status: detail.status || assignment.status,
      score: detail.score || assignment.score,
      isMissing: detail.isMissing,
      detailResolved: true,
      confidence: Math.max(assignment.confidence || 0, detail.confidence || 0),
    });
  }

  return resolved;
}

async function extractAssignments(page, options = {}) {
  const extracted = await page.evaluate(() => {
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
        const base = location.origin && location.origin !== "null" ? location.origin : "https://bcps.schoology.com";
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
  });

  let assignments = extracted.map((item) => {
    const signals = buildRowSignals(item);
    return {
      ...signals,
      course: normalizeText(item.course || ""),
      title: deriveSchoologyAssignmentTitle({
        title: signals.title || normalizeText(item.title || ""),
        titleText: signals.titleText || normalizeText(item.titleText || ""),
        rawText: signals.rawText,
      }),
    };
  });

  assignments = await resolveAmbiguousAssignments(page, assignments, options);
  assignments = dedupeAssignments(assignments);

  return assignments.map((item) => {
    const rawText = normalizeText(item.rawText || "");
    const title = deriveSchoologyAssignmentTitle({
      title: normalizeText(item.title || ""),
      titleText: normalizeText(item.titleText || ""),
      rawText,
    });
    return {
      course: normalizeText(item.course || ""),
      title,
      dueDate: normalizeText(item.dueDate || ""),
      status: normalizeText(item.status || "Missing"),
      score: normalizeText(item.score || ""),
      url: normalizeText(item.url || ""),
      rawText,
      isMissing: Boolean(item.isMissing),
    };
  });
}

async function dumpDebug(page, config) {
  if (!config.debug.dump) return;
  ensureDir(config.paths.dataDir);
  try {
    const html = await page.content();
    fs.writeFileSync(config.paths.debugHtmlPath, html, "utf8");
  } catch {
    // ignore
  }
  try {
    await page.screenshot({ path: config.paths.debugScreenshotPath, fullPage: true });
  } catch {
    // ignore
  }
}

export function isRetryableLoginError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return (
    message.includes("login failed") ||
    message.includes("login required") ||
    message.includes("login flow not recognized")
  );
}

function visibleLoginSelectorsSnapshot(page) {
  if (!page) return {};
  return page
    .evaluate(() => {
      const selectors = [
        "input#edit-name",
        "input#edit-mail",
        "input#edit-school",
        "input#signInName",
        "input[name='loginfmt']",
        "#AzureADBCPSOrgExchange",
        "#MicrosoftAccountExchange",
        "#idSIButton9",
      ];
      const output = {};
      for (const selector of selectors) {
        const el = document.querySelector(selector);
        if (!el) {
          output[selector] = false;
          continue;
        }
        const style = window.getComputedStyle(el);
        output[selector] = style.display !== "none" && style.visibility !== "hidden";
      }
      return output;
    })
    .catch(() => ({}));
}

async function writeLoginDiagnostic(config, page, error, { attempt, maxAttempts, usedStorageState }) {
  try {
    ensureDir(config.paths.dataDir);
    const payload = {
      generatedAt: new Date().toISOString(),
      attempt,
      maxAttempts,
      usedStorageState,
      idp: config?.schoology?.idp || "auto",
      loginUrl: config?.schoology?.loginUrl || "",
      gradesUrl: config?.schoology?.gradesUrl || "",
      pageUrl: page?.url?.() || "",
      error: String(error?.message || error || ""),
      visibleSelectors: await visibleLoginSelectorsSnapshot(page),
      storagePath: config?.paths?.storagePath || "",
      storagePathExists: Boolean(config?.paths?.storagePath && fs.existsSync(config.paths.storagePath)),
    };
    fs.writeFileSync(config.paths.loginDiagnosticPath, JSON.stringify(payload, null, 2), "utf8");
    return config.paths.loginDiagnosticPath;
  } catch {
    return "";
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function scrapeMissingAssignments(config) {
  ensureDir(config.paths.dataDir);

  const maxAttempts = Math.max(1, Number(config?.schoology?.loginAttempts || 2));
  const retryDelayMs = Math.max(0, Number(config?.schoology?.loginRetryDelayMs || 1500));
  const storageExists = fs.existsSync(config.paths.storagePath);
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const useStorageState = storageExists && attempt === 1;
    const contextOptions = useStorageState ? { storageState: config.paths.storagePath } : {};
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext(contextOptions);
    const page = await context.newPage();
    page.setDefaultTimeout(30000);

    try {
      await ensureLoggedIn(page, config);
      await selectStudentIfNeeded(page, config.schoology.studentName);
      await page.waitForLoadState("networkidle");

      const assignments = await extractAssignments(page, {
        detailFetcher: (url) => fetchDetailHtml(page, url),
      });
      await context.storageState({ path: config.paths.storagePath });

      if (assignments.length === 0) {
        await dumpDebug(page, config);
      }

      return assignments;
    } catch (err) {
      await dumpDebug(page, config);
      const diagnosticPath = await writeLoginDiagnostic(config, page, err, {
        attempt,
        maxAttempts,
        usedStorageState: useStorageState,
      });
      if (diagnosticPath) {
        err.loginDiagnosticPath = diagnosticPath;
      }
      lastError = err;
      if (!isRetryableLoginError(err) || attempt >= maxAttempts) {
        throw err;
      }
      await sleep(retryDelayMs);
    } finally {
      await browser.close();
    }
  }

  if (lastError) {
    throw lastError;
  }
  throw new Error("Scrape failed without a captured error.");
}

export async function extractMissingAssignmentsFromHtml(html) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: "domcontentloaded" });
    const assignments = await extractAssignments(page);
    return assignments.filter((item) => item.isMissing);
  } finally {
    await browser.close();
  }
}

export async function extractAssignmentsFromHtml(html, options = {}) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: "domcontentloaded" });
    return await extractAssignments(page, options);
  } finally {
    await browser.close();
  }
}
