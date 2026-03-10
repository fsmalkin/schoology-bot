const ASSIGNMENT_OUTCOMES = [
  {
    value: "submitted",
    label: "Submitted",
    description: "Adds the standard note and moves the assignment to waiting on teacher.",
  },
  {
    value: "waiting_teacher",
    label: "Waiting on teacher",
    description: "Use when the next move belongs to the teacher or gradebook.",
  },
  {
    value: "excused",
    label: "Excused",
    description: "Files the assignment away so it stops creating noise.",
  },
  {
    value: "practice_only",
    label: "Practice only",
    description: "Keeps the assignment on record as practice rather than a grading concern.",
  },
  {
    value: "let_it_go",
    label: "Let it go",
    description: "Use when there is no practical recovery path and you want it out of the nightly queue.",
  },
  {
    value: "grade_not_posted",
    label: "Grade not posted yet",
    description: "Use when the work is done but Schoology still has not caught up.",
  },
  {
    value: "none",
    label: "No special status",
    description: "Clears any local override and returns the assignment to normal review.",
  },
];

const state = {
  meta: null,
  home: null,
  assignments: null,
  tasks: null,
  health: null,
  activeView: "home",
  assignmentSearch: "",
  bulkMode: false,
  selectedAssignmentKeys: new Set(),
  homeExpandedSections: {
    waiting: false,
    comingUp: false,
    handled: false,
  },
  schoolworkHandledExpanded: false,
  drawer: {
    kind: null,
    key: null,
    id: null,
    data: null,
    loading: false,
    mode: null,
    focus: null,
    section: null,
    returnFocusId: null,
  },
};

let flashTimer = null;

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function truncate(value, max = 84) {
  const text = String(value || "").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}...`;
}

function safeId(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function shortenCourseLabel(value, max = 28) {
  const text = String(value || "").trim();
  if (!text) return "Assignment";
  const primary = text.includes(":") ? text.split(":")[0].trim() : text;
  return truncate(primary || text, max);
}

function joinCompactParts(parts) {
  return parts
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(" / ");
}

function assignmentMetaLine(item) {
  return joinCompactParts([item.dueDateLabel || "No due date", item.schoologyStatus || ""]);
}

function taskMetaLine(task) {
  return joinCompactParts([task.remindAtLabel || "No reminder time", task.recurrenceLabel || ""]);
}

function previewLimitForSection(key) {
  return key === "handled" ? 0 : 2;
}

function isHomeSectionExpanded(key) {
  return Boolean(state.homeExpandedSections[key]);
}

function currentDrawerSection() {
  if (state.drawer.kind !== "assignment") return "details";
  if (state.drawer.section === "reminder" || state.drawer.section === "notes") return state.drawer.section;
  return "status";
}

function sectionFocus(section) {
  if (section === "reminder") return "reminder";
  if (section === "notes") return "note";
  if (section === "title") return "title";
  return null;
}

function statusClass(category) {
  if (category === "pending") return "pending";
  if (category === "ignored") return "ignored";
  return "actionable";
}

function toneClass(stateValue) {
  if (stateValue === "ok") return "ok";
  if (stateValue === "stale") return "stale";
  return "down";
}

function getManualStatusOptions() {
  return Array.isArray(state.meta?.manualStatuses) ? state.meta.manualStatuses : [];
}

function getRecurrenceOptions() {
  return Array.isArray(state.meta?.recurrences) ? state.meta.recurrences : [];
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, { cache: "no-store", ...options });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error || `Request failed (${response.status})`);
  }
  return payload;
}

function toolHeaders() {
  return {
    "Content-Type": "application/json",
    "X-Schoology-Dashboard-Request": "1",
  };
}

function setRefreshButtonsBusy(busy) {
  document.querySelectorAll('[data-action="refresh-assignments"]').forEach((node) => {
    if (!(node instanceof HTMLButtonElement)) return;
    if (!node.dataset.defaultLabel) {
      node.dataset.defaultLabel = node.textContent || "Refresh Schoology";
    }
    node.disabled = busy;
    node.textContent = busy ? "Refreshing..." : node.dataset.defaultLabel;
  });
}

function refreshSuccessMessage(output) {
  const segments = [];
  if (Number.isFinite(Number(output?.actionableCount))) {
    segments.push(`${Number(output.actionableCount)} need attention`);
  }
  if (Number.isFinite(Number(output?.pendingCount))) {
    segments.push(`${Number(output.pendingCount)} waiting on school`);
  }
  if (Number.isFinite(Number(output?.ignoredCount))) {
    segments.push(`${Number(output.ignoredCount)} handled for now`);
  }
  if (segments.length === 0) return "Schoology refresh finished.";
  return `Refresh complete. ${segments.join(", ")}.`;
}

async function runTool(tool, args) {
  const payload = await fetchJson("/api/tools/run", {
    method: "POST",
    headers: toolHeaders(),
    body: JSON.stringify({ tool, args }),
  });
  return payload.output || {};
}

function showFlash(message, tone = "info") {
  const slot = document.getElementById("flash");
  if (!slot) return;
  if (flashTimer) clearTimeout(flashTimer);
  slot.innerHTML = message ? `<div class="flash ${esc(tone)}">${esc(message)}</div>` : "";
  if (message) {
    flashTimer = setTimeout(() => {
      slot.innerHTML = "";
    }, 4400);
  }
}

function setHeroSubtitle(text) {
  const subtitle = document.getElementById("heroSubtitle");
  if (subtitle) subtitle.textContent = text;
}

function formatLocalInputValue(dateLike) {
  const parsed = new Date(dateLike);
  if (!Number.isFinite(parsed.getTime())) return "";
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  const hour = String(parsed.getHours()).padStart(2, "0");
  const minute = String(parsed.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function nextSchoolDayValue(base = new Date()) {
  const next = new Date(base);
  next.setSeconds(0, 0);
  next.setHours(16, 0, 0, 0);
  next.setDate(next.getDate() + 1);
  while (next.getDay() === 0 || next.getDay() === 6) {
    next.setDate(next.getDate() + 1);
  }
  return formatLocalInputValue(next);
}

function assignmentReminderSeed(item) {
  if (item?.nextReminder) {
    return {
      reminderId: item.nextReminder.id || "",
      remindAt: formatLocalInputValue(item.nextReminder.remindAtUtc || item.nextReminder.remindAt || ""),
      recurrence: item.nextReminder.recurrenceKind || "none",
      message: item.nextReminder.message || "",
    };
  }
  return {
    reminderId: "",
    remindAt: nextSchoolDayValue(),
    recurrence: "none",
    message: item?.course ? `Follow up on ${item.course} - ${item.title}` : `Follow up on ${item?.title || "this assignment"}`,
  };
}

function manualStatusOptionsMarkup(selectedValue) {
  return getManualStatusOptions()
    .map((option) => {
      const selected = String(option.value || "") === String(selectedValue || "") ? "selected" : "";
      const label = option.code ? `${option.code} - ${option.label}` : option.label;
      return `<option value="${esc(option.value)}" ${selected}>${esc(label)}</option>`;
    })
    .join("");
}

function recurrenceOptionsMarkup(selectedValue) {
  return getRecurrenceOptions()
    .map((option) => {
      const selected = String(option.value || "") === String(selectedValue || "") ? "selected" : "";
      return `<option value="${esc(option.value)}" ${selected}>${esc(option.label)}</option>`;
    })
    .join("");
}

function assignmentSearchMatches(row) {
  const needle = state.assignmentSearch.trim().toLowerCase();
  if (!needle) return true;
  const haystack = [
    row.course,
    row.title,
    row.schoologyStatus,
    row.displayStatusLabel,
    row.manualStatus,
    row.reasonText,
    ...(row.notesPreview || []).map((note) => note.note),
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(needle);
}

function filteredAssignmentRows() {
  const rows = Array.isArray(state.assignments?.rows) ? state.assignments.rows : [];
  return rows.filter(assignmentSearchMatches);
}

function selectedVisibleCount(rows) {
  return rows.filter((row) => state.selectedAssignmentKeys.has(row.key)).length;
}

function pruneSelectedAssignmentKeys() {
  const available = new Set((state.assignments?.rows || []).map((row) => row.key));
  state.selectedAssignmentKeys = new Set([...state.selectedAssignmentKeys].filter((key) => available.has(key)));
}

function currentHomeSection(key) {
  return state.home?.sections?.[key] || { rows: [], label: "", emptyLabel: "" };
}

function groupAssignmentRows(rows) {
  return rows.reduce(
    (groups, row) => {
      const bucket = row.displayCategory === "pending" ? "pending" : row.displayCategory === "ignored" ? "ignored" : "actionable";
      groups[bucket].push(row);
      return groups;
    },
    { actionable: [], pending: [], ignored: [] }
  );
}

function assignmentSurfaceId(key) {
  return `surface-assignment-${safeId(key)}`;
}

function taskSurfaceId(id) {
  return `surface-task-${safeId(id)}`;
}

function updateHeroSubtitle() {
  if (state.activeView === "admin" && state.health) {
    setHeroSubtitle(
      `Last scrape ${state.health.activity?.lastScrapeLabel || "unknown"}. Last summary ${state.health.activity?.lastSummaryLabel || "unknown"}.`
    );
    return;
  }
  if (state.activeView === "schoolwork" && state.assignments) {
    const rows = filteredAssignmentRows();
    if (state.bulkMode) {
      setHeroSubtitle(
        `${rows.length} assignment${rows.length === 1 ? "" : "s"} in view. ${selectedVisibleCount(rows)} selected for bulk updates.`
      );
      return;
    }
    setHeroSubtitle(`${rows.length} assignment${rows.length === 1 ? "" : "s"} ready to review. Click a card to open it.`);
    return;
  }
  if (state.home) {
    const summary = state.home.summary || {};
    const next = summary.nextReminder?.remindAtLabel
      ? ` Next reminder: ${summary.nextReminder.remindAtLabel}.`
      : " No reminder is queued yet.";
    setHeroSubtitle(
      `${summary.tonightCount || 0} need attention tonight. ${summary.waitingCount || 0} are waiting on school.${next}`
    );
    return;
  }
  setHeroSubtitle("Loading your after-school plan...");
}

function renderPrimaryViews() {
  const root = document.getElementById("primaryViews");
  const adminButton = document.getElementById("adminViewButton");
  if (!root) return;
  const tabs = state.meta?.primaryViews || [];
  root.innerHTML = tabs
    .map(
      (tab) =>
        `<button type="button" class="tab-button ${tab.id === state.activeView ? "active" : ""}" data-action="switch-view" data-view="${esc(tab.id)}">${esc(tab.label)}</button>`
    )
    .join("");
  if (adminButton) {
    adminButton.textContent = state.meta?.utilityViews?.[0]?.label || "Admin";
    adminButton.classList.toggle("active", state.activeView === "admin");
  }
}

function syncDrawerChrome() {
  const drawer = document.getElementById("detailDrawer");
  const backdrop = document.getElementById("drawerBackdrop");
  const open = Boolean(state.drawer.kind);
  if (drawer) {
    drawer.dataset.open = open ? "true" : "false";
    drawer.setAttribute("aria-hidden", open ? "false" : "true");
  }
  if (backdrop) {
    backdrop.dataset.open = open ? "true" : "false";
    backdrop.setAttribute("aria-hidden", open ? "false" : "true");
  }
  document.body.classList.toggle("drawer-open", open);
}

function renderVisibility() {
  document.querySelectorAll("[data-view-panel]").forEach((panel) => {
    panel.hidden = panel.getAttribute("data-view-panel") !== state.activeView;
  });
  syncDrawerChrome();
}

function renderIndicatorPills(items) {
  const cleanItems = items.map((item) => String(item || "").trim()).filter(Boolean);
  if (!cleanItems.length) return "";
  return `<div class="card-indicators">${esc(cleanItems.join(" / "))}</div>`;
}

function renderAssignmentIndicators(item) {
  const indicators = [];
  if (item.notesCount > 0) indicators.push(`${item.notesCount} note${item.notesCount === 1 ? "" : "s"}`);
  if (item.nextReminder?.remindAtLabel) indicators.push(`Reminder ${truncate(item.nextReminder.remindAtLabel, 32)}`);
  return renderIndicatorPills(indicators);
}

function renderTaskIndicators(task) {
  const indicators = [];
  if (task.message) indicators.push("Has note");
  if (task.recurrenceLabel && task.recurrenceLabel !== "One-time") indicators.push(task.recurrenceLabel);
  return renderIndicatorPills(indicators);
}

function renderAssignmentCard(item, surface, options = {}) {
  const surfaceId = assignmentSurfaceId(item.key);
  const selected = options.selectable && state.selectedAssignmentKeys.has(item.key);
  const selectionChip = options.selectable
    ? `<label class="card-select" data-ignore-open="1"><input type="checkbox" data-action="toggle-assignment-select" data-key="${esc(item.key)}" ${selected ? "checked" : ""} /> <strong>${selected ? "Selected" : "Select"}</strong></label>`
    : "";
  return `
    <article
      id="${esc(surfaceId)}"
      class="surface-card assignment-card ${options.compact ? "compact-card" : ""} ${selected ? "selected" : ""}"
      data-open-assignment-key="${esc(item.key)}"
      data-surface="${esc(surface)}"
      data-surface-card="assignment"
      tabindex="0"
      role="button"
      aria-label="Review ${esc(item.title)}"
    >
      <div class="card-head">
        <span class="card-kicker">${esc(shortenCourseLabel(item.course))}</span>
        <div class="card-trail">
          <span class="status-pill ${statusClass(item.displayCategory)}">${esc(item.bucketLabel)}</span>
          ${selectionChip}
        </div>
      </div>
      <h3 class="card-title">${esc(item.title)}</h3>
      <div class="card-meta">${esc(assignmentMetaLine(item))}</div>
      <p class="card-reason">${esc(truncate(item.reasonText || "Needs review.", options.compact ? 86 : 112))}</p>
      ${renderAssignmentIndicators(item)}
    </article>
  `;
}

function renderTaskCard(task, surface, options = {}) {
  const surfaceId = taskSurfaceId(task.id);
  return `
    <article
      id="${esc(surfaceId)}"
      class="surface-card followup-card ${options.compact ? "compact-card" : ""}"
      data-open-task-id="${esc(task.id)}"
      data-surface="${esc(surface)}"
      data-surface-card="task"
      tabindex="0"
      role="button"
      aria-label="Review ${esc(task.title)}"
    >
      <div class="card-head">
        <span class="card-kicker">Follow-up</span>
        <span class="status-pill ${statusClass(task.displayCategory)}">${esc(task.displayStatusLabel || "Saved")}</span>
      </div>
      <h3 class="card-title">${esc(task.title)}</h3>
      <div class="card-meta">${esc(taskMetaLine(task))}</div>
      <p class="card-reason">${esc(truncate(task.reasonText || "Keep this follow-up nearby for later.", options.compact ? 82 : 96))}</p>
      ${renderTaskIndicators(task)}
    </article>
  `;
}

function renderHomeCards(items, sectionKey, options = {}) {
  if (!items.length) {
    return `<p class="empty-state">${esc(options.emptyLabel || "Nothing here right now.")}</p>`;
  }
  return `<div class="card-stack ${options.compact ? "compact-stack" : ""}">${items
    .map((item) =>
      item.kind === "task"
        ? renderTaskCard(item, `home-${sectionKey}`, { compact: options.compact })
        : renderAssignmentCard(item, `home-${sectionKey}`, { compact: options.compact })
    )
    .join("")}</div>`;
}

function renderHomePrimarySection(section) {
  const items = Array.isArray(section?.rows) ? section.rows : [];
  return `
    <section class="home-primary-panel">
      <div class="section-head">
        <div>
          <p class="section-kicker">Tonight first</p>
          <h3 class="section-title">${esc(section.label || "Needs Attention Tonight")}</h3>
        </div>
        <span class="status-pill actionable">${esc(items.length)}</span>
      </div>
      ${renderHomeCards(items, "tonight", { emptyLabel: section.emptyLabel })}
    </section>
  `;
}

function renderHomeSecondarySection(key, section, options = {}) {
  const items = Array.isArray(section?.rows) ? section.rows : [];
  const expanded = isHomeSectionExpanded(key);
  const previewLimit = previewLimitForSection(key);
  const visibleItems = expanded || previewLimit === 0 ? items : items.slice(0, previewLimit);
  const countTone = key === "handled" ? "ignored" : "pending";
  const toggleLabel =
    key === "handled"
      ? expanded
        ? "Hide"
        : "Show all"
      : items.length > previewLimit
        ? expanded
          ? "Show fewer"
          : "Show all"
        : "";
  const content =
    key === "handled" && !expanded
      ? `<p class="secondary-summary">${items.length === 0 ? esc(section.emptyLabel || "Nothing is tucked away.") : `${esc(items.length)} item${items.length === 1 ? "" : "s"} tucked away here.`}</p>`
      : renderHomeCards(visibleItems, key, { compact: true, emptyLabel: section.emptyLabel });
  return `
    <section class="secondary-section ${expanded ? "is-expanded" : ""}">
      <div class="secondary-head">
        <div>
          <h3 class="secondary-title">${esc(section.label || "")}</h3>
          <p class="secondary-copy">${esc(options.copy || "")}</p>
        </div>
        <div class="secondary-trail">
          <span class="status-pill ${countTone}">${esc(items.length)}</span>
          ${
            toggleLabel
              ? `<button type="button" class="text-button" data-action="toggle-home-section" data-section="${esc(key)}">${esc(toggleLabel)}</button>`
              : ""
          }
        </div>
      </div>
      ${content}
    </section>
  `;
}

function renderHomePane() {
  const root = document.getElementById("homePane");
  if (!root) return;
  if (!state.home) {
    root.innerHTML = `<p class="empty-state">Loading your after-school plan...</p>`;
    return;
  }
  const summary = state.home.summary || {};
  const nextReminder = summary.nextReminder;
  root.innerHTML = `
    <div class="summary-ribbon">
      <div class="summary-stat"><span class="label">Tonight</span><span class="value">${esc(summary.tonightCount || 0)}</span><span class="support">Need a decision tonight.</span></div>
      <div class="summary-stat"><span class="label">Waiting</span><span class="value">${esc(summary.waitingCount || 0)}</span><span class="support">Already in motion.</span></div>
      <div class="summary-stat"><span class="label">Next reminder</span><span class="value">${esc(nextReminder?.remindAtLabel || "None set")}</span><span class="support">${esc(nextReminder?.title || "Create a follow-up when you need one.")}</span></div>
    </div>
    ${renderHomePrimarySection(currentHomeSection("tonight"))}
    <div class="home-secondary-list">
      ${renderHomeSecondarySection("waiting", currentHomeSection("waiting"), { copy: "Work that is waiting on the teacher or gradebook." })}
      ${renderHomeSecondarySection("comingUp", currentHomeSection("comingUp"), { copy: "What is already on the horizon." })}
      ${renderHomeSecondarySection("handled", currentHomeSection("handled"), { copy: "Filed away so the main list stays calm." })}
    </div>
  `;
}

function renderSchoolworkGroup(title, copy, rows, emptyLabel, surface) {
  return `
    <section class="schoolwork-group" data-lane="${esc(surface)}">
      <div class="group-head">
        <div>
          <h3>${esc(title)}</h3>
          <p class="group-copy">${esc(copy)}</p>
        </div>
        <span class="status-pill ${statusClass(surface === "pending" ? "pending" : "actionable")}">${esc(rows.length)}</span>
      </div>
      ${
        rows.length === 0
          ? `<p class="empty-state lane-empty">${esc(emptyLabel)}</p>`
          : `<div class="card-stack compact-stack">${rows
              .map((row) => renderAssignmentCard(row, `schoolwork-${surface}`, { selectable: state.bulkMode, compact: true }))
              .join("")}</div>`
      }
    </section>
  `;
}

function renderHandledLane(rows) {
  const expanded = state.schoolworkHandledExpanded;
  return `
    <section class="schoolwork-group handled-group ${expanded ? "is-expanded" : ""}">
      <div class="group-head">
        <div>
          <h3>Handled for now</h3>
          <p class="group-copy">Completed or intentionally filed away.</p>
        </div>
        <div class="secondary-trail">
          <span class="status-pill ignored">${esc(rows.length)}</span>
          <button type="button" class="text-button" data-action="toggle-schoolwork-handled">${expanded ? "Hide" : "Show all"}</button>
        </div>
      </div>
      ${
        !expanded
          ? `<p class="secondary-summary">${rows.length === 0 ? "Nothing is filed away in this view." : `${rows.length} item${rows.length === 1 ? "" : "s"} tucked away here.`}</p>`
          : rows.length === 0
            ? `<p class="empty-state lane-empty">Nothing is filed away in this view.</p>`
            : `<div class="card-stack compact-stack">${rows
                .map((row) => renderAssignmentCard(row, "schoolwork-ignored", { selectable: state.bulkMode, compact: true }))
                .join("")}</div>`
      }
    </section>
  `;
}

function renderSchoolworkPane() {
  const root = document.getElementById("schoolworkPane");
  if (!root) return;
  if (!state.assignments) {
    root.innerHTML = `<p class="empty-state">Loading assignments...</p>`;
    return;
  }
  const rows = filteredAssignmentRows();
  const visibleSelected = selectedVisibleCount(rows);
  const filters = state.assignments.filters || {};
  const groups = groupAssignmentRows(rows);
  root.innerHTML = `
    <div class="toolbar-row schoolwork-toolbar">
      <div class="control-cluster">
        <label class="field-label inline-field">
          Show
          <select class="field-select" id="assignmentStatusFilter">
            ${(state.meta?.assignmentStatusFilters || [])
              .map((filter) => `<option value="${esc(filter.value)}" ${filter.value === filters.status ? "selected" : ""}>${esc(filter.label)}</option>`)
              .join("")}
          </select>
        </label>
        <input class="search-field" id="assignmentSearch" type="search" placeholder="Search assignments, notes, or statuses" value="${esc(state.assignmentSearch)}" />
      </div>
      <div class="control-cluster">
        <button type="button" class="${state.bulkMode ? "solid-button" : "ghost-button"}" data-action="toggle-bulk-mode">${state.bulkMode ? "Done selecting" : "Bulk select"}</button>
      </div>
    </div>
    ${
      state.bulkMode
        ? `<div class="bulk-bar">
            <div class="control-cluster">
              <span class="selection-copy">${esc(visibleSelected)} selected in view</span>
              <button type="button" class="chip-button" data-action="select-visible-assignments" ${rows.length === 0 ? "disabled" : ""}>Select visible</button>
              <button type="button" class="chip-button" data-action="clear-assignment-selection" ${state.selectedAssignmentKeys.size === 0 ? "disabled" : ""}>Clear selection</button>
            </div>
            <div class="control-cluster">
              <select class="field-select" id="bulkStatusSelect">${manualStatusOptionsMarkup("")}</select>
              <button type="button" class="solid-button" data-action="apply-bulk-status" ${state.selectedAssignmentKeys.size === 0 ? "disabled" : ""}>Apply</button>
            </div>
          </div>`
        : ""
    }
    <div class="schoolwork-results">${esc(rows.length)} assignment${rows.length === 1 ? "" : "s"} in view</div>
    ${
      rows.length === 0
        ? `<p class="empty-state">No assignments match the current filter.</p>`
        : `<div class="schoolwork-list">
            ${renderSchoolworkGroup("Needs attention", "The assignments that still need a decision from you.", groups.actionable, "Nothing urgent matches this view.", "actionable")}
            ${renderSchoolworkGroup("Waiting on school", "Already submitted or waiting on a teacher, grade, or Schoology change.", groups.pending, "Nothing is waiting on school in this view.", "pending")}
            ${renderHandledLane(groups.ignored)}
          </div>`
    }
  `;
}

function renderAdminPane() {
  const root = document.getElementById("adminPane");
  if (!root) return;
  if (!state.health) {
    root.innerHTML = `<p class="empty-state">Loading service health...</p>`;
    return;
  }
  const metrics = [
    { label: "Needs attention", value: state.health.assignments?.actionable || 0 },
    { label: "Waiting on school", value: state.health.assignments?.waiting || 0 },
    { label: "Handled for now", value: state.health.assignments?.ignored || 0 },
    { label: "Follow-ups pending", value: state.health.tasks?.pending || 0 },
    { label: "Follow-ups overdue", value: state.health.tasks?.overdue || 0 },
    { label: "Follow-ups today", value: state.health.tasks?.today || 0 },
  ];
  root.innerHTML = `
    <div class="service-grid">
      ${(state.health.services || [])
        .map(
          (service) =>
            `<div class="service-card"><div class="drawer-stat-line"><strong>${esc(service.label)}</strong><span class="tiny-pill ${toneClass(service.state)}">${esc(String(service.state || "down").toUpperCase())}</span></div><p class="support-copy">Last seen: ${esc(service.lastSeenLabel)}<br />Age: ${esc(service.ageLabel)}</p></div>`
        )
        .join("")}
    </div>
    <div class="admin-grid">
      <article class="mini-panel">
        <h3>At a glance</h3>
        <div class="metric-grid">${metrics.map((metric) => `<div class="metric-card"><span class="label">${esc(metric.label)}</span><span class="value">${esc(metric.value)}</span></div>`).join("")}</div>
        <p class="activity-copy">Last scrape: <strong>${esc(state.health.activity?.lastScrapeLabel || "Never")}</strong><br />Last summary: <strong>${esc(state.health.activity?.lastSummaryLabel || "Never")}</strong></p>
      </article>
      <article class="mini-panel"><h3>How it works</h3><ul class="plain-list">${(state.health.howItWorks || []).map((line) => `<li>${esc(line)}</li>`).join("")}</ul></article>
      <article class="mini-panel"><h3>Docs</h3><ul class="plain-list">${Object.values(state.health.docs || {}).map((value) => `<li><span class="mono-block">${esc(value)}</span></li>`).join("")}</ul></article>
      <article class="mini-panel"><h3>Quick commands</h3><div class="command-list">${(state.health.quickCommands || []).map((command) => `<div class="mono-block">${esc(command)}</div>`).join("")}</div></article>
      <article class="mini-panel"><h3>File state</h3><ul class="plain-list">${(state.health.files || []).map((file) => `<li>${esc(file.label)}: ${file.exists ? "present" : "missing"}<br /><span class="cell-subtle">${esc(file.path)}</span></li>`).join("")}</ul></article>
    </div>
  `;
}

function currentAssignmentOutcome(assignment) {
  const manual = String(assignment?.manualStatus || "");
  if (manual === "Waiting on teacher") return "waiting_teacher";
  if (manual === "Excused (doesn't count)") return "excused";
  if (manual === "Practice / not for grade") return "practice_only";
  if (manual === "No way to fix it") return "let_it_go";
  if (manual === "No grade put in yet") return "grade_not_posted";
  return "none";
}

function renderOutcomeOptions(selectedValue) {
  return ASSIGNMENT_OUTCOMES.map((outcome) => {
    const checked = outcome.value === selectedValue;
    return `
      <label class="outcome-option ${checked ? "is-selected" : ""}">
        <input type="radio" name="outcome" value="${esc(outcome.value)}" ${checked ? "checked" : ""} />
        <span class="outcome-title">${esc(outcome.label)}</span>
        <span class="outcome-copy">${esc(outcome.description)}</span>
      </label>
    `;
  }).join("");
}

function renderDrawerSection(title, section, summary, body, options = {}) {
  const open = currentDrawerSection() === section;
  const buttonLabel = open ? "Open" : "Edit";
  return `
    <section class="drawer-section ${open ? "is-open" : ""}">
      <button type="button" class="drawer-section-toggle" data-action="open-drawer-section" data-section="${esc(section)}">
        <span class="drawer-section-copy">
          <strong>${esc(title)}</strong>
          <span class="drawer-section-summary">${esc(summary)}</span>
        </span>
        <span class="drawer-section-action">${esc(open ? (options.openLabel || "Editing") : buttonLabel)}</span>
      </button>
      ${open ? `<div class="drawer-section-body">${body}</div>` : ""}
    </section>
  `;
}

function renderAssignmentDrawer(root) {
  const detail = state.drawer.data;
  if (!detail) {
    root.innerHTML = `<div class="drawer-loading"><p class="empty-state">Assignment details unavailable.</p></div>`;
    return;
  }
  const assignment = detail.assignment || {};
  const pendingReminder = detail.pendingReminder || null;
  const notes = Array.isArray(detail.notes) ? detail.notes : [];
  const reminderSeed = assignmentReminderSeed(assignment);
  const statusSummary = assignment.displayStatusLabel || assignment.bucketLabel || "No special status";
  const reminderSummary = pendingReminder?.remindAtLabel
    ? `${pendingReminder.remindAtLabel}${pendingReminder.recurrenceLabel ? ` / ${pendingReminder.recurrenceLabel}` : ""}`
    : "No reminder set";
  const notesSummary =
    notes.length > 0 ? `${notes.length} note${notes.length === 1 ? "" : "s"} saved` : "No notes yet";
  root.innerHTML = `
    <div class="drawer-content">
      <div class="drawer-header">
        <div class="drawer-header-copy">
          <p class="drawer-eyebrow">${esc(assignment.course || "Assignment")}</p>
          <h2 id="drawerTitle">${esc(assignment.title || "Assignment")}</h2>
          <p class="drawer-summary">${esc(joinCompactParts([assignment.dueDateLabel || assignment.dueDate || "No due date", assignment.displayStatusLabel || assignment.schoologyStatus || "Needs review"]))}</p>
          ${assignment.reasonText ? `<p class="support-copy">${esc(truncate(assignment.reasonText, 116))}</p>` : ""}
          <div class="drawer-link-row">
            <span class="status-pill ${statusClass(assignment.displayCategory)}">${esc(assignment.bucketLabel || "Needs attention")}</span>
            ${assignment.url ? `<a class="text-link" href="${esc(assignment.url)}" target="_blank" rel="noreferrer">Open in Schoology</a>` : ""}
          </div>
        </div>
        <button type="button" class="ghost-button" data-action="close-drawer" data-drawer-initial="1">Close</button>
      </div>

      <div class="drawer-overview">
        <div class="overview-row"><span class="label">Current status</span><strong>${esc(assignment.bucketLabel || "Needs attention")}</strong><span class="support">${esc(assignment.displayStatusLabel || "Needs review")}</span></div>
        <div class="overview-row"><span class="label">Next reminder</span><strong>${esc(pendingReminder?.remindAtLabel || "None set")}</strong><span class="support">${esc(pendingReminder?.recurrenceLabel || "One-time")}</span></div>
        <div class="overview-row"><span class="label">Latest note</span><strong>${esc(assignment.previewNote ? truncate(assignment.previewNote, 42) : "No notes yet")}</strong><span class="support">${esc(`${notes.length} note${notes.length === 1 ? "" : "s"} total`)}</span></div>
      </div>

      ${renderDrawerSection(
        "Update status",
        "status",
        statusSummary,
        `
          <form class="field-grid" data-form="assignment-status">
            <input type="hidden" name="key" value="${esc(assignment.key)}" />
            <div class="outcome-grid">
              ${renderOutcomeOptions(currentAssignmentOutcome(assignment))}
            </div>
            <div class="drawer-form-actions">
              <span class="support-copy">Nothing changes until you save.</span>
              <button type="submit" class="solid-button">Save status</button>
            </div>
          </form>
        `,
        { openLabel: "Editing" }
      )}

      ${renderDrawerSection(
        "Reminder",
        "reminder",
        reminderSummary,
        `
          ${pendingReminder ? `<p class="support-copy">Current reminder: ${esc(reminderSummary)}</p>` : `<p class="support-copy">Set the next nudge without leaving this drawer.</p>`}
          <form class="field-grid" data-form="assignment-drawer-reminder">
            <input type="hidden" name="key" value="${esc(assignment.key)}" />
            <input type="hidden" name="reminderId" value="${esc(reminderSeed.reminderId)}" />
            <div class="field-grid two-column">
              <label class="field-label">
                Follow-up time
                <input class="field-input" type="datetime-local" name="remindAt" value="${esc(reminderSeed.remindAt)}" ${currentDrawerSection() === "reminder" ? "data-autofocus=\"1\"" : ""} required />
              </label>
              <label class="field-label">
                Recurrence
                <select class="field-select" name="recurrence">${recurrenceOptionsMarkup(reminderSeed.recurrence)}</select>
              </label>
            </div>
            <label class="field-label">
              Reminder note
              <input class="field-input" name="message" value="${esc(reminderSeed.message)}" placeholder="Optional follow-up note" />
            </label>
            <div class="drawer-form-actions">
              <span class="support-copy">Uses the same reminder rules as chat.</span>
              <div class="control-cluster">
                ${pendingReminder ? `<button type="button" class="ghost-button" data-action="delete-reminder" data-id="${esc(pendingReminder.id)}" data-key="${esc(assignment.key)}">Delete</button>` : ""}
                <button type="submit" class="solid-button">${pendingReminder ? "Save reminder" : "Create reminder"}</button>
              </div>
            </div>
          </form>
        `
      )}

      ${renderDrawerSection(
        "Notes",
        "notes",
        notesSummary,
        `
          ${
            notes.length > 0
              ? `<div class="note-stack">${notes.map((note) => `<div class="mono-block"><strong>${esc(note.createdAt || "")}</strong><br />${esc(note.note)}</div>`).join("")}</div>`
              : `<p class="empty-state">No notes yet.</p>`
          }
          <form class="field-grid" data-form="assignment-drawer-note">
            <input type="hidden" name="key" value="${esc(assignment.key)}" />
            <label class="field-label">
              Add note
              <textarea class="field-textarea" name="note" placeholder="Leave yourself a note for later" ${currentDrawerSection() === "notes" ? "data-autofocus=\"1\"" : ""} required></textarea>
            </label>
            <div class="drawer-form-actions">
              <span class="support-copy">Notes stay append-only.</span>
              <button type="submit" class="solid-button">Save note</button>
            </div>
          </form>
        `
      )}
    </div>
  `;
}

function renderTaskDrawer(root) {
  const task = state.drawer.data || {};
  const isEdit = state.drawer.mode === "edit";
  root.innerHTML = `
    <div class="drawer-content">
      <div class="drawer-header">
        <div class="drawer-header-copy">
          <p class="drawer-eyebrow">${isEdit ? "Follow-up" : "New follow-up"}</p>
          <h2 id="drawerTitle">${isEdit ? esc(task.title || "Edit follow-up") : "Add a follow-up"}</h2>
          <p class="drawer-summary">${esc(isEdit ? task.remindAtLabel || "Update the details below." : "Create a personal follow-up.")}</p>
        </div>
        <button type="button" class="ghost-button" data-action="close-drawer" data-drawer-initial="1">Close</button>
      </div>

      ${
        isEdit
          ? `<div class="drawer-overview">
              <div class="overview-row"><span class="label">Status</span><strong>${esc(task.status === "done" ? "Completed" : "Pending")}</strong><span class="support">${esc(task.displayStatusLabel || "Saved follow-up")}</span></div>
              <div class="overview-row"><span class="label">Reminder</span><strong>${esc(task.remindAtLabel || "No reminder time")}</strong><span class="support">${esc(task.recurrenceLabel || "One-time")}</span></div>
            </div>`
          : ""
      }

      <section class="drawer-section is-open">
        <div class="drawer-section-body">
          <form class="field-grid" data-form="task">
            <input type="hidden" name="id" value="${esc(task.id || "")}" />
            <label class="field-label">
              Title
              <input class="field-input" name="title" value="${esc(task.title || "")}" placeholder="Email math teacher" ${state.drawer.focus === "title" ? "data-autofocus=\"1\"" : ""} required />
            </label>
            <div class="field-grid two-column">
              <label class="field-label">
                Follow-up time
                <input class="field-input" type="datetime-local" name="remindAt" value="${esc(formatLocalInputValue(task.remindAtUtc || task.remindAt || nextSchoolDayValue()))}" required />
              </label>
              <label class="field-label">
                Recurrence
                <select class="field-select" name="recurrence">${recurrenceOptionsMarkup(task.recurrenceKind || "none")}</select>
              </label>
            </div>
            <label class="field-label">
              Note
              <textarea class="field-textarea" name="message" placeholder="Optional note for later">${esc(task.message || "")}</textarea>
            </label>
            <div class="drawer-form-actions">
              <span class="support-copy">Recurring options stay limited to one-time, daily, weekdays, or weekly.</span>
              <div class="control-cluster">
                ${
                  isEdit
                    ? `${
                        task.status === "done"
                          ? `<button type="button" class="ghost-button" data-action="task-toggle-status" data-id="${esc(task.id)}" data-status="pending">Reopen</button>`
                          : `<button type="button" class="ghost-button" data-action="task-toggle-status" data-id="${esc(task.id)}" data-status="done">Mark done</button>`
                      }<button type="button" class="ghost-button" data-action="delete-task" data-id="${esc(task.id)}">Delete</button>`
                    : ""
                }
                <button type="submit" class="solid-button">${isEdit ? "Save follow-up" : "Create follow-up"}</button>
              </div>
            </div>
          </form>
        </div>
      </section>
    </div>
  `;
}

function renderDrawer() {
  const root = document.getElementById("drawerContent");
  if (!root) return;
  if (!state.drawer.kind) {
    root.innerHTML = "";
    return;
  }
  if (state.drawer.loading) {
    root.innerHTML = `<div class="drawer-loading"><p class="drawer-eyebrow">Loading</p><h2 id="drawerTitle">Fetching details...</h2><p class="support-copy">The review drawer is loading the latest details.</p></div>`;
    return;
  }
  if (state.drawer.kind === "assignment") {
    renderAssignmentDrawer(root);
    return;
  }
  renderTaskDrawer(root);
}

function renderAll() {
  renderPrimaryViews();
  renderVisibility();
  renderHomePane();
  renderSchoolworkPane();
  renderAdminPane();
  renderDrawer();
  updateHeroSubtitle();
}

function focusDrawerTarget() {
  const target = document.querySelector("[data-autofocus='1']") || document.querySelector("[data-drawer-initial='1']");
  if (target instanceof HTMLElement) {
    requestAnimationFrame(() => {
      target.focus();
      if (typeof target.select === "function" && target.matches("input, textarea")) target.select();
    });
  }
}

function restoreFocus(surfaceId) {
  if (!surfaceId) return;
  requestAnimationFrame(() => {
    const target = document.getElementById(surfaceId);
    if (target instanceof HTMLElement) target.focus();
  });
}

async function loadMeta() {
  state.meta = await fetchJson("/api/meta");
  renderAll();
}

async function loadHome() {
  state.home = await fetchJson("/api/home");
  renderAll();
}

async function loadAssignments() {
  const params = new URLSearchParams({
    status: state.assignments?.filters?.status || "missing",
    includePending: "true",
    includeIgnored: "true",
  });
  state.assignments = await fetchJson(`/api/assignments?${params.toString()}`);
  if (state.assignments?.filters) {
    state.assignments.filters.includePending = true;
    state.assignments.filters.includeIgnored = true;
  }
  pruneSelectedAssignmentKeys();
  renderAll();
}

async function loadTasks() {
  state.tasks = await fetchJson("/api/tasks?status=all");
  if (state.drawer.kind === "task" && state.drawer.mode === "edit") {
    const nextTask = findTaskById(state.drawer.id);
    if (nextTask) state.drawer.data = nextTask;
  }
  renderAll();
}

async function loadHealth() {
  state.health = await fetchJson("/api/health");
  renderAll();
}

async function openAssignmentDrawer(key, options = {}) {
  const nextFocus = options.focus ?? state.drawer.focus ?? null;
  const nextSection = options.section ?? state.drawer.section ?? (nextFocus === "reminder" ? "reminder" : nextFocus === "note" ? "notes" : "status");
  const returnFocusId = options.openerId ?? state.drawer.returnFocusId ?? null;
  state.drawer = {
    kind: "assignment",
    key,
    id: null,
    data: null,
    loading: true,
    mode: "view",
    focus: nextFocus,
    section: nextSection,
    returnFocusId,
  };
  renderAll();
  state.drawer = {
    kind: "assignment",
    key,
    id: null,
    data: await fetchJson(`/api/assignments/${encodeURIComponent(key)}/detail`),
    loading: false,
    mode: "view",
    focus: nextFocus,
    section: nextSection,
    returnFocusId,
  };
  renderAll();
  focusDrawerTarget();
}

function findTaskById(id) {
  return (state.tasks?.rows || []).find((row) => String(row.id) === String(id)) || null;
}

function openTaskDrawer(task = null, options = {}) {
  state.drawer = {
    kind: "task",
    key: null,
    id: task?.id || null,
    data: task,
    loading: false,
    mode: task ? "edit" : "create",
    focus: options.focus ?? null,
    section: "details",
    returnFocusId: options.openerId ?? state.drawer.returnFocusId ?? null,
  };
  renderAll();
  focusDrawerTarget();
}

function closeDrawer() {
  const returnFocusId = state.drawer.returnFocusId;
  state.drawer = {
    kind: null,
    key: null,
    id: null,
    data: null,
    loading: false,
    mode: null,
    focus: null,
    section: null,
    returnFocusId: null,
  };
  renderAll();
  restoreFocus(returnFocusId);
}

async function refreshAssignmentViews(key = null) {
  await Promise.all([loadHome(), loadAssignments()]);
  if (state.drawer.kind === "assignment" && (state.drawer.key || key)) {
    await openAssignmentDrawer(key || state.drawer.key, {
      focus: state.drawer.focus || null,
      section: state.drawer.section || "status",
      openerId: state.drawer.returnFocusId || null,
    });
  }
}

async function refreshTaskViews(id = null) {
  await Promise.all([loadHome(), loadTasks()]);
  if (state.drawer.kind === "task" && (state.drawer.id || id)) {
    const nextTask = findTaskById(id || state.drawer.id);
    if (nextTask) {
      openTaskDrawer(nextTask, { openerId: state.drawer.returnFocusId || null });
    } else if (id) {
      closeDrawer();
    }
  }
}

async function refreshCurrentView() {
  if (state.activeView === "admin") {
    await loadHealth();
    showFlash("Admin health refreshed.", "success");
    return;
  }
  if (state.activeView === "schoolwork") {
    await refreshAssignmentViews();
    showFlash("Schoolwork refreshed.", "success");
    return;
  }
  await Promise.all([loadHome(), loadTasks()]);
  if (state.drawer.kind === "assignment" && state.drawer.key) {
    await openAssignmentDrawer(state.drawer.key, {
      focus: state.drawer.focus || null,
      section: state.drawer.section || "status",
      openerId: state.drawer.returnFocusId || null,
    });
  } else if (state.drawer.kind === "task" && state.drawer.id) {
    const task = findTaskById(state.drawer.id);
    if (task) openTaskDrawer(task, { openerId: state.drawer.returnFocusId || null });
  }
  showFlash("Home refreshed.", "success");
}

function formValue(form, name) {
  return new FormData(form).get(name) || "";
}

async function setAssignmentStatus(key, status, successMessage = "Assignment updated.") {
  const output = await runTool("update_assignment_status", { key, status });
  if (output.ok === false) {
    showFlash(output.error || "Assignment update failed.", "error");
    return false;
  }
  showFlash(successMessage, "success");
  await refreshAssignmentViews(key);
  return true;
}

async function markAssignmentSubmitted(key) {
  const noteResult = await runTool("add_assignment_note", {
    key,
    note: "Marked submitted from dashboard.",
  });
  const statusResult = await runTool("update_assignment_status", {
    key,
    status: "E",
  });
  await refreshAssignmentViews(key);
  if (noteResult.ok === false && statusResult.ok === false) {
    showFlash(`${noteResult.error || "Note add failed."} ${statusResult.error || "Status update failed."}`.trim(), "error");
    return false;
  }
  if (noteResult.ok === false || statusResult.ok === false) {
    const successes = [];
    const failures = [];
    if (noteResult.ok !== false) successes.push("note saved");
    else failures.push(`note failed: ${noteResult.error || "unknown error"}`);
    if (statusResult.ok !== false) successes.push("status set to waiting on teacher");
    else failures.push(`status failed: ${statusResult.error || "unknown error"}`);
    showFlash(`Submitted partially applied: ${successes.join(", ")}. ${failures.join(". ")}`, "warn");
    return false;
  }
  showFlash("Marked submitted and moved to waiting on teacher.", "success");
  return true;
}

async function handleAssignmentStatusSubmit(form) {
  const key = formValue(form, "key");
  const outcome = formValue(form, "outcome") || "none";
  if (outcome === "submitted") {
    return await markAssignmentSubmitted(key);
  }
  const outcomeToStatus = {
    waiting_teacher: "E",
    excused: "A",
    practice_only: "B",
    let_it_go: "C",
    grade_not_posted: "D",
    none: "",
  };
  const outcomeToMessage = {
    waiting_teacher: "Marked as waiting on teacher.",
    excused: "Marked as excused.",
    practice_only: "Marked as practice only.",
    let_it_go: "Marked to let go.",
    grade_not_posted: "Marked as grade not posted yet.",
    none: "Special status cleared.",
  };
  return await setAssignmentStatus(key, outcomeToStatus[outcome] ?? "", outcomeToMessage[outcome] || "Assignment updated.");
}

async function handleBulkStatusApply() {
  const selectedKeys = [...state.selectedAssignmentKeys];
  if (selectedKeys.length === 0) {
    showFlash("Select at least one assignment first.", "error");
    return;
  }
  const status = document.getElementById("bulkStatusSelect")?.value ?? "";
  const output = await runTool("bulk_update_assignment_statuses", {
    updates: selectedKeys.map((key) => ({ key, status })),
  });
  if (output.ok === false) {
    showFlash(output.error || "Bulk update failed.", "error");
    return;
  }
  showFlash(`Updated ${selectedKeys.length} assignment${selectedKeys.length === 1 ? "" : "s"}.`, "success");
  await refreshAssignmentViews();
}

async function handleAssignmentNoteSubmit(form) {
  const key = formValue(form, "key");
  const output = await runTool("add_assignment_note", {
    key,
    note: formValue(form, "note"),
  });
  if (output.ok === false) {
    showFlash(output.error || "Note save failed.", "error");
    return;
  }
  showFlash("Note added.", "success");
  await refreshAssignmentViews(key);
}

async function handleAssignmentReminderSubmit(form) {
  const key = formValue(form, "key");
  const reminderId = formValue(form, "reminderId");
  const args = {
    remindAt: formValue(form, "remindAt"),
    recurrence: formValue(form, "recurrence"),
    message: formValue(form, "message"),
  };
  const output = reminderId
    ? await runTool("update_assignment_reminder", { id: Number(reminderId), ...args })
    : await runTool("schedule_reminder", { key, replaceExisting: true, ...args });
  if (output.ok === false) {
    showFlash(output.error || "Reminder save failed.", "error");
    return;
  }
  const assumptionMessage =
    Array.isArray(output.assumptions) && output.assumptions.length > 0
      ? ` ${output.assumptions[0]?.reason || ""}`.trim()
      : "";
  showFlash(`Reminder saved.${assumptionMessage ? ` ${assumptionMessage}` : ""}`, "success");
  await refreshAssignmentViews(key);
}

async function handleTaskSubmit(form) {
  const id = formValue(form, "id");
  const args = {
    title: formValue(form, "title"),
    remindAt: formValue(form, "remindAt"),
    recurrence: formValue(form, "recurrence"),
    message: formValue(form, "message"),
  };
  const output = id ? await runTool("update_task", { id: Number(id), ...args }) : await runTool("create_task", args);
  if (output.ok === false) {
    showFlash(output.error || "Follow-up save failed.", "error");
    return;
  }
  showFlash(id ? "Follow-up updated." : "Follow-up created.", "success");
  await refreshTaskViews(id || output.id || null);
  if (!id) closeDrawer();
}

async function deleteReminder(id, key = null) {
  const output = await runTool("delete_assignment_reminder", { id: Number(id) });
  if (output.ok === false) {
    showFlash(output.error || "Reminder delete failed.", "error");
    return;
  }
  showFlash("Reminder deleted.", "success");
  await refreshAssignmentViews(key);
}

async function deleteTask(id) {
  const output = await runTool("delete_task", { id: Number(id) });
  if (output.ok === false) {
    showFlash(output.error || "Delete failed.", "error");
    return;
  }
  showFlash("Follow-up deleted.", "success");
  await refreshTaskViews(id);
}

async function toggleTaskStatus(id, nextStatus) {
  const output = await runTool("update_task_status", { id: Number(id), status: nextStatus });
  if (output.ok === false) {
    showFlash(output.error || "Status change failed.", "error");
    return;
  }
  showFlash(nextStatus === "done" ? "Follow-up marked done." : "Follow-up reopened.", "success");
  await refreshTaskViews(id);
}

async function refreshSchoology() {
  setRefreshButtonsBusy(true);
  showFlash("Refreshing Schoology...", "info");
  try {
    const output = await runTool("refresh_schoology", {});
    if (output.ok === false) {
      showFlash(output.error || "Schoology refresh failed.", "error");
      return;
    }
    await Promise.all([loadHome(), loadAssignments(), loadHealth(), loadTasks()]);
    if (state.drawer.kind === "assignment" && state.drawer.key) {
      await openAssignmentDrawer(state.drawer.key, {
        focus: state.drawer.focus || null,
        section: state.drawer.section || "status",
        openerId: state.drawer.returnFocusId || null,
      });
    }
    showFlash(refreshSuccessMessage(output), "success");
  } finally {
    setRefreshButtonsBusy(false);
  }
}

function shouldIgnoreSurfaceOpen(target) {
  return Boolean(target.closest("a, button, input, select, textarea, label, summary, [data-ignore-open='1']"));
}

async function openSurfaceFromElement(element) {
  if (!(element instanceof HTMLElement)) return;
  if (element.hasAttribute("data-open-assignment-key")) {
    await openAssignmentDrawer(element.getAttribute("data-open-assignment-key"), {
      openerId: element.id || null,
    });
    return;
  }
  if (element.hasAttribute("data-open-task-id")) {
    const task = findTaskById(element.getAttribute("data-open-task-id"));
    openTaskDrawer(task, {
      openerId: element.id || null,
    });
  }
}

document.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const actionTarget = target.closest("[data-action]");
  if (actionTarget) {
    const action = actionTarget.getAttribute("data-action");
    try {
      if (action === "switch-view") {
        state.activeView = actionTarget.getAttribute("data-view") || "home";
        renderAll();
        return;
      }
      if (action === "refresh-current") return await refreshCurrentView();
      if (action === "copy-url") {
        await navigator.clipboard.writeText(window.location.href);
        showFlash("Dashboard URL copied.", "success");
        return;
      }
      if (action === "refresh-assignments") return await refreshSchoology();
      if (action === "refresh-admin") {
        await loadHealth();
        showFlash("Admin health refreshed.", "success");
        return;
      }
      if (action === "toggle-home-section") {
        const section = actionTarget.getAttribute("data-section");
        if (!section) return;
        state.homeExpandedSections[section] = !state.homeExpandedSections[section];
        renderHomePane();
        return;
      }
      if (action === "toggle-schoolwork-handled") {
        state.schoolworkHandledExpanded = !state.schoolworkHandledExpanded;
        renderSchoolworkPane();
        return;
      }
      if (action === "toggle-bulk-mode") {
        state.bulkMode = !state.bulkMode;
        if (!state.bulkMode) state.selectedAssignmentKeys.clear();
        renderSchoolworkPane();
        updateHeroSubtitle();
        return;
      }
      if (action === "toggle-assignment-select") {
        const key = actionTarget.getAttribute("data-key");
        if (!key) return;
        if (actionTarget.checked) state.selectedAssignmentKeys.add(key);
        else state.selectedAssignmentKeys.delete(key);
        renderSchoolworkPane();
        updateHeroSubtitle();
        return;
      }
      if (action === "select-visible-assignments") {
        filteredAssignmentRows().forEach((row) => state.selectedAssignmentKeys.add(row.key));
        renderSchoolworkPane();
        updateHeroSubtitle();
        return;
      }
      if (action === "clear-assignment-selection") {
        state.selectedAssignmentKeys.clear();
        renderSchoolworkPane();
        updateHeroSubtitle();
        return;
      }
      if (action === "apply-bulk-status") return await handleBulkStatusApply();
      if (action === "delete-reminder") return await deleteReminder(actionTarget.getAttribute("data-id"), actionTarget.getAttribute("data-key"));
      if (action === "new-task") return openTaskDrawer(null, { focus: "title" });
      if (action === "task-toggle-status") return await toggleTaskStatus(actionTarget.getAttribute("data-id"), actionTarget.getAttribute("data-status"));
      if (action === "delete-task") return await deleteTask(actionTarget.getAttribute("data-id"));
      if (action === "open-drawer-section") {
        const section = actionTarget.getAttribute("data-section") || "status";
        state.drawer.section = section;
        state.drawer.focus = sectionFocus(section);
        renderDrawer();
        focusDrawerTarget();
        return;
      }
      if (action === "close-drawer") return closeDrawer();
    } catch (err) {
      showFlash(err.message || String(err), "error");
    }
    return;
  }
  if (shouldIgnoreSurfaceOpen(target)) return;
  const surface = target.closest("[data-open-assignment-key], [data-open-task-id]");
  if (!surface) return;
  try {
    await openSurfaceFromElement(surface);
  } catch (err) {
    showFlash(err.message || String(err), "error");
  }
});

document.addEventListener("submit", async (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  const formType = form.getAttribute("data-form");
  try {
    if (formType === "assignment-status") {
      event.preventDefault();
      return await handleAssignmentStatusSubmit(form);
    }
    if (formType === "assignment-drawer-note") {
      event.preventDefault();
      return await handleAssignmentNoteSubmit(form);
    }
    if (formType === "assignment-drawer-reminder") {
      event.preventDefault();
      return await handleAssignmentReminderSubmit(form);
    }
    if (formType === "task") {
      event.preventDefault();
      return await handleTaskSubmit(form);
    }
  } catch (err) {
    showFlash(err.message || String(err), "error");
  }
});

document.addEventListener("input", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  if (target.id === "assignmentSearch") {
    state.assignmentSearch = target.value || "";
    renderSchoolworkPane();
    updateHeroSubtitle();
    return;
  }
  if (target.name === "outcome") {
    const form = target.closest(".field-grid");
    if (form instanceof HTMLElement) {
      form.querySelectorAll(".outcome-option").forEach((option) => {
        option.classList.toggle("is-selected", option.querySelector("input")?.checked === true);
      });
    }
  }
});

document.addEventListener("change", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  try {
    if (target.id === "assignmentStatusFilter") {
      state.assignments.filters.status = target.value;
      return await loadAssignments();
    }
  } catch (err) {
    showFlash(err.message || String(err), "error");
  }
});

document.addEventListener("keydown", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  if (event.key === "Escape" && state.drawer.kind) {
    event.preventDefault();
    closeDrawer();
    return;
  }
  if (event.key !== "Enter" && event.key !== " ") return;
  if (!target.matches("[data-open-assignment-key], [data-open-task-id]")) return;
  event.preventDefault();
  try {
    await openSurfaceFromElement(target);
  } catch (err) {
    showFlash(err.message || String(err), "error");
  }
});

async function init() {
  try {
    await loadMeta();
    await Promise.all([loadHome(), loadAssignments(), loadTasks(), loadHealth()]);
    renderAll();
    setInterval(() => {
      loadHealth().catch(() => {});
    }, 30000);
  } catch (err) {
    showFlash(err.message || String(err), "error");
    setHeroSubtitle("Dashboard failed to load.");
  }
}

init();
