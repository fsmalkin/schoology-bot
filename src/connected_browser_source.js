// The existing browser worker reads the sanctioned tab; the app validates and
// imports its narrow projection. This module never opens a browser or session.
import { createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { projectCurrentGradebook } from "./current_gradebook.js";

const sourceUrl = "https://bcps.schoology.com/grades/grades";
const exactKeys = (value, keys) => value && typeof value === "object" && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

export function connectedBrowserSourceContract(config) {
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(config.browserSourceExtensionInstanceId || "") ||
      !/^\d+$/.test(config.studentProfileId || "") || !/^\d+$/.test(config.currentTermId || "") ||
      !/^MP ?[1-4] 20\d\d-20\d\d$/.test(config.currentTerm || "") ||
      typeof config.principalId !== "string" || !config.principalId || /[\r\n]/.test(config.principalId)) {
    throw Error("Exact existing browser, subject, caller and term required");
  }
  if (typeof config.browserSourceRuntimeModule !== "string" || !path.isAbsolute(config.browserSourceRuntimeModule) ||
      path.basename(config.browserSourceRuntimeModule) !== "browser-client.mjs") throw Error("Installed supported browser runtime module required");
  if (config.browserSourceTabId !== undefined && !/^[A-Za-z0-9_-]{1,128}$/.test(config.browserSourceTabId)) throw Error("Invalid bound source tab");
  const reader = projectCurrentGradebook.toString();
  const expectedScope = { principalId: config.principalId, studentId: config.studentProfileId,
    currentTermId: config.currentTermId, currentTermLabel: config.currentTerm };
  const readerSha256 = createHash("sha256").update(reader).digest("hex");
  const extensionInstanceId = config.browserSourceExtensionInstanceId;
  // One exact app-driver call performs the supported setup/navigation/read.
  // The worker cannot supply arbitrary prep code or transcribe the source.
  const captureCode = `await (await import(${JSON.stringify(import.meta.url)})).captureConnectedBrowserSource(${JSON.stringify({
    runtimeModule: pathToFileURL(config.browserSourceRuntimeModule).href,
    extensionInstanceId, preferredTabId: config.browserSourceTabId || null, readerSha256, expectedScope,
  })});`;
  return { format: "schoology-connected-browser-source/v1", browserExtensionInstanceId: extensionInstanceId,
    sourceUrl, readerSha256, expectedScope, captureCode };
}

export async function openConnectedGradesTab(browser, preferredTabId = null) {
  const tabs = (await browser.tabs.list()).filter(tab => tab.url === sourceUrl);
  const selected = preferredTabId ? tabs.find(tab => tab.id === preferredTabId) : tabs.sort((a, b) => a.id.localeCompare(b.id))[0];
  if (preferredTabId && !selected) throw Error("Bound task-owned source tab unavailable");
  // Duplicate read-only Grades tabs in one profile do not imply conflicting
  // accounts. Reload one stable owned tab and verify identity before records.
  const tab = selected ? await browser.tabs.get(selected.id) : await browser.tabs.new();
  if (selected) await tab.reload(); else await tab.goto(sourceUrl);
  return tab;
}

export async function verifyConnectedSourceIdentity(tab, expectedScope) {
  if (await tab.url() !== sourceUrl) throw Error("Approved source account required before roster access: source URL changed");
  const profile = tab.playwright.getByRole("menuitem", { name: "Your Profile", exact: true });
  if (!(await profile.isVisible())) {
    await tab.playwright.locator("button.Z_KgC").click();
  }
  // The click acknowledgement is not evidence that the menu has rendered.
  await profile.waitFor({ state: "visible", timeoutMs: 10000 });
  const identity = await tab.playwright.evaluate(() => ({ origin: location.origin, pathname: location.pathname,
    profiles: Array.from(document.querySelectorAll('[role="menuitem"]'))
      .filter(item => (item.textContent || "").trim() === "Your Profile")
      .map(item => item.getAttribute("href") || item.querySelector("a[href]")?.getAttribute("href")) }));
  if (identity.origin !== "https://bcps.schoology.com" || identity.pathname !== "/grades/grades") throw Error("Approved source account required before roster access: origin/path changed");
  if (identity.profiles.length !== 1) throw Error("Approved source account required before roster access: profile menu missing or ambiguous");
  if (new URL(identity.profiles[0], identity.origin).href !== `https://bcps.schoology.com/user/${expectedScope.studentId}/info`) throw Error("Approved source account required before roster access: profile mismatch");
}

export async function captureConnectedBrowserSource({ runtimeModule, extensionInstanceId, preferredTabId, readerSha256, expectedScope }) {
  const reader = projectCurrentGradebook.toString();
  if (createHash("sha256").update(reader).digest("hex") !== readerSha256 ||
      !String(runtimeModule).startsWith("file:") || !String(runtimeModule).endsWith("/browser-client.mjs")) throw Error("App reader/runtime binding changed");
  const { setupBrowserRuntime } = await import(runtimeModule);
  const sourceApi = await setupBrowserRuntime();
  // Short browser IDs belong to one runtime and can change on every CLI turn.
  // Resolve only the already-sanctioned extension, before opening any source tab.
  const matches = (await sourceApi.browsers.list()).filter(browser => browser.type === "extension" &&
    browser.metadata?.extensionInstanceId === extensionInstanceId);
  if (matches.length !== 1) throw Error("Exact sanctioned browser extension missing or ambiguous");
  const browserId = matches[0].id;
  const browser = await sourceApi.browsers.get(browserId);
  await browser.nameSession("📚 Schoology source");
  const tab = await openConnectedGradesTab(browser, preferredTabId);
  await verifyConnectedSourceIdentity(tab, expectedScope);
  const headings = await tab.playwright.locator(".gradebook-course-title").all();
  if (!headings.length || headings.length > 100) throw Error("Current official Grades page required");
  const closed = await tab.playwright.evaluate(() => Array.from(document.querySelectorAll("div.gradebook-course"))
    .map((course, index) => {
      const report = course.querySelector(".gradebook-course-grades");
      if (!report) throw Error("Incomplete course report");
      return getComputedStyle(report).display === "none" ? index : null;
    }).filter(index => index !== null));
  for (const index of closed) {
    if (!headings[index]) throw Error("Course roster changed during observation");
    await headings[index].click();
  }
  // Course expansion can dismiss the account menu required by the projector.
  await verifyConnectedSourceIdentity(tab, expectedScope);
  const expression = `(${reader})({document,origin:location.origin,pathname:location.pathname,observedAt:new Date().toISOString(),expectedScope:${JSON.stringify(expectedScope)}})`;
  const source = await tab.playwright.evaluate(expression);
  nodeRepl.write("SCHOOLOGY_SOURCE_V1:" + JSON.stringify({ browserId, browserExtensionInstanceId: extensionInstanceId,
    sourceTabId: tab.id, sourceUrl, readerSha256, source }));
}

export function validateConnectedBrowserSource(config, envelope, now = new Date()) {
  const contract = connectedBrowserSourceContract(config);
  if (!exactKeys(envelope, ["browserId", "browserExtensionInstanceId", "sourceTabId", "sourceUrl", "readerSha256", "source"]) ||
      typeof envelope.browserId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(envelope.browserId) ||
      envelope.browserExtensionInstanceId !== contract.browserExtensionInstanceId || envelope.sourceUrl !== sourceUrl ||
      envelope.readerSha256 !== contract.readerSha256 || typeof envelope.sourceTabId !== "string" ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(envelope.sourceTabId) ||
      (config.browserSourceTabId && envelope.sourceTabId !== config.browserSourceTabId)) throw Error("Unbound browser source");
  const source = envelope.source;
  if (!exactKeys(source, ["format", "subjectVerified", "currentTermVerified", "currentTerm", "sourceScope", "snapshot"]) ||
      source.format !== "schoology-qualified-current-term/v1" || source.subjectVerified !== true || source.currentTermVerified !== true ||
      !exactKeys(source.currentTerm, ["id", "label"]) || source.currentTerm.id !== config.currentTermId || source.currentTerm.label !== config.currentTerm ||
      !exactKeys(source.sourceScope, ["principalId", "studentId", "currentTermId"]) ||
      source.sourceScope.principalId !== config.principalId || source.sourceScope.studentId !== config.studentProfileId || source.sourceScope.currentTermId !== config.currentTermId) {
    throw Error("Unqualified browser subject or term");
  }
  const snapshot = source.snapshot;
  if (!exactKeys(snapshot, ["format", "sourceOrigin", "observedAt", "complete", "assignments"]) ||
      snapshot.format !== "schoology-current-assignments/v1" || snapshot.sourceOrigin !== "https://bcps.schoology.com" || snapshot.complete !== true ||
      typeof snapshot.observedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(snapshot.observedAt) ||
      !Array.isArray(snapshot.assignments) || snapshot.assignments.length > 1000) throw Error("Incomplete browser source");
  const age = now.getTime() - Date.parse(snapshot.observedAt);
  if (!Number.isFinite(age) || age < -30000 || age > 900000) throw Error("Fresh browser observation required");
  for (const row of snapshot.assignments) {
    if (!exactKeys(row, ["course", "title", "dueDate", "status", "isMissing", "url"]) ||
        typeof row.course !== "string" || !row.course.trim() || row.course.length > 160 ||
        typeof row.title !== "string" || !row.title.trim() || row.title.length > 400 ||
        typeof row.dueDate !== "string" || row.dueDate.length > 100 ||
        !["Missing", "Incomplete", "Submitted", "Not marked missing", "Submitted, awaiting grade",
          "Submitted, awaiting grade (Schoology also marks Missing)", "Submitted, awaiting grade (Schoology also marks Incomplete)",
          "Submitted (grading status unknown)", "Submitted (grading status unknown; Schoology also marks Missing)",
          "Submitted (grading status unknown; Schoology also marks Incomplete)", "Draft (not submitted)",
          "Missing (draft not submitted)", "Incomplete (draft not submitted)", "Exempt", "Exempt (draft not submitted)",
          "Submitted (Exempt; ungraded marker)", "Submitted (Exempt; grading status unknown)"].includes(row.status) ||
        row.isMissing !== (["Missing", "Incomplete"].includes(row.status) || /Schoology also marks (?:Missing|Incomplete)\)/.test(row.status) || /^(?:Missing|Incomplete) \(draft not submitted\)$/.test(row.status)) || typeof row.url !== "string" ||
        (row.url && !/^https:\/\/bcps\.schoology\.com\/assignment\/[1-9][0-9]*$/.test(row.url))) throw Error("Invalid browser assignment projection");
  }
  return { source, sourceSha256: createHash("sha256").update(JSON.stringify(source)).digest("hex") };
}
