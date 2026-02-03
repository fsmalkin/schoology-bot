import fs from "fs";
import path from "path";
import { chromium } from "playwright";

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
  const emailInput = page.locator('input[type="email"], input[name="loginfmt"]');
  if (!(await isVisible(emailInput.first()))) return false;

  await emailInput.first().fill(username);
  await clickByText(page, /Next|Sign in/i);

  const passwordInput = page.locator('input[type="password"], input[name="passwd"]');
  await passwordInput.first().waitFor({ timeout: 15000 });
  await passwordInput.first().fill(password);
  await clickByText(page, /Sign in|Next/i);

  const staySignedInNo = page.locator("#idBtn_Back");
  if (await isVisible(staySignedInNo)) {
    await staySignedInNo.click();
  }

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

  const selector = selectors[provider];
  if (selector && (await hasSelector(page, selector))) {
    await page.click(selector);
    await page.waitForLoadState("domcontentloaded");
    return true;
  }

  if (provider === "microsoft") {
    if (await clickByText(page, /Microsoft/i)) {
      await page.waitForLoadState("domcontentloaded");
      return true;
    }
  }
  if (provider === "azuread") {
    if (await clickByText(page, /BCPS Account|BCPS Students|Login with your BCPS/i)) {
      await page.waitForLoadState("domcontentloaded");
      return true;
    }
  }
  if (provider === "google") {
    if (await clickByText(page, /Google/i)) {
      await page.waitForLoadState("domcontentloaded");
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

  const ssoLink = page.locator(".sso-login-link, text=SSO Login");
  if (await isVisible(ssoLink.first())) {
    await ssoLink.first().click();
  } else {
    await clickByText(page, /SSO Login|School or District|Log in through/i);
  }

  const schoolInput = page.locator("#edit-school, input[placeholder*='School']");
  try {
    await schoolInput.first().waitFor({ state: "visible", timeout: 4000 });
  } catch {
    // fall through
  }

  if (await isBcpsB2CPage(page)) return true;

  if (await schoolInput.first().isVisible().catch(() => false)) {
    const schoolName = config.schoology.ssoSchool || "Baltimore County Public Schools";
    await schoolInput.first().fill(schoolName);
    await page.waitForTimeout(800);

    const suggestion = page.locator(".ui-autocomplete li, .ui-menu-item, .ac_results li").first();
    if (await isVisible(suggestion)) {
      await suggestion.click();
    } else {
      await schoolInput.first().press("Enter");
    }
    const submitButton = page.locator("#edit-submit, input#edit-submit, button[type='submit']");
    if (await isVisible(submitButton.first())) {
      await Promise.allSettled([
        page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 8000 }),
        submitButton.first().click(),
      ]);
    }
  } else if (await schoolInput.first().isVisible().catch(() => false) === false) {
    // Try forcing the value if the field is still hidden but present
    const count = await schoolInput.count();
    if (count > 0) {
      const schoolName = config.schoology.ssoSchool || "Baltimore County Public Schools";
      await schoolInput.first().fill(schoolName, { force: true });
      await page.waitForTimeout(800);
      await schoolInput.first().press("Enter");
    }
  }

  await page.waitForTimeout(800);
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

  throw new Error(
    "Login failed. Set SCHOLOGY_IDP in .env (e.g. 'microsoft') and retry. DEBUG_DUMP=true will capture the page."
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

async function extractMissingAssignments(page) {
  return await page.evaluate(() => {
    const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const cleanTrailingLabel = (value) =>
      normalize(value).replace(/[\s.:-]*(assignment|test-quiz|external-tool-link|discussion)$/i, "");
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
        const titleLink =
          row.querySelector("a[href*='/assignment']") || row.querySelector("a[href]") || null;
        const title = titleLink ? cleanTrailingLabel(titleLink.textContent) : "";
        const url = titleLink ? new URL(titleLink.getAttribute("href"), location.origin).toString() : "";

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

        const submissionText = normalize(
          gradeColumn?.querySelector(".dropbox-icon-inline-image-wrapper .visually-hidden")?.textContent || ""
        );
        const statusHints = [commentText, exceptionText, submissionText, gradeColumnText]
          .filter(Boolean)
          .join(" ");

        const isMissing = missingPatterns.some((pattern) => pattern.test(statusHints));
        if (!isMissing) {
          continue;
        }

        results.push({
          course,
          title,
          dueDate,
          status: commentText || exceptionText || "Missing",
          score: gradeText,
          url,
          rawText: normalize(row.textContent || ""),
        });
      }
    }

    return results;
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

export async function scrapeMissingAssignments(config) {
  ensureDir(config.paths.dataDir);

  const storageExists = fs.existsSync(config.paths.storagePath);
  const contextOptions = storageExists ? { storageState: config.paths.storagePath } : {};

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  page.setDefaultTimeout(30000);

  try {
    await ensureLoggedIn(page, config);
    await selectStudentIfNeeded(page, config.schoology.studentName);
    await page.waitForLoadState("networkidle");

    const assignments = await extractMissingAssignments(page);

    await context.storageState({ path: config.paths.storagePath });

    if (assignments.length === 0) {
      await dumpDebug(page, config);
    }

    return assignments.map((a) => ({
      course: normalizeText(a.course || ""),
      title: normalizeText(a.title || ""),
      dueDate: normalizeText(a.dueDate || ""),
      status: a.status || "Missing",
      score: normalizeText(a.score || ""),
      url: a.url || "",
      rawText: normalizeText(a.rawText || ""),
    }));
  } catch (err) {
    await dumpDebug(page, config);
    throw err;
  } finally {
    await browser.close();
  }
}
