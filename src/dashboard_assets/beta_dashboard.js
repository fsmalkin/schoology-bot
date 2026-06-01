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
    value: "will_complete_in_class",
    label: "Will complete in class",
    description: "Use when the work will be finished during class time instead of at home.",
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
let refreshBusyTimer = null;
let refreshBusyStartedAt = 0;
let renderSequence = 0;
let assignmentDrawerRequestSeq = 0;

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

function setRefreshButtonsBusyWithProgress(busy) {
  document.querySelectorAll('[data-action="refresh-assignments"]').forEach((node) => {
    if (!(node instanceof HTMLButtonElement)) return;
    node.disabled = busy;
    if (node.classList.contains("icon-btn")) return;
    if (!node.dataset.defaultLabel) {
      node.dataset.defaultLabel = node.textContent?.trim() || "Refresh Schoology";
    }
    node.textContent = busy ? "Refreshing…" : node.dataset.defaultLabel;
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

function formatElapsedLabel(elapsedMs) {
  const totalSeconds = Math.max(0, Math.round(Number(elapsedMs || 0) / 1000));
  if (totalSeconds < 1) return "<1s";
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

function refreshButtonBusyLabel() {
  if (!refreshBusyStartedAt) return "Refreshing...";
  return `Refreshing... ${formatElapsedLabel(Date.now() - refreshBusyStartedAt)}`;
}

function renderRefreshButtonsBusyState() {
  document.querySelectorAll('[data-action="refresh-assignments"]').forEach((node) => {
    if (!(node instanceof HTMLButtonElement)) return;
    node.disabled = true;
    if (node.classList.contains("icon-btn")) return;
    if (!node.dataset.defaultLabel) {
      node.dataset.defaultLabel = node.textContent?.trim() || "Refresh Schoology";
    }
    node.textContent = refreshButtonBusyLabel();
  });
}

function setRefreshButtonsBusy(busy) {
  if (refreshBusyTimer) {
    clearInterval(refreshBusyTimer);
    refreshBusyTimer = null;
  }
  document.querySelectorAll('[data-action="refresh-assignments"]').forEach((node) => {
    if (!(node instanceof HTMLButtonElement)) return;
    node.disabled = busy;
    if (!node.dataset.defaultLabel) {
      node.dataset.defaultLabel = node.textContent?.trim() || "Refresh Schoology";
    }
    if (!busy && !node.classList.contains("icon-btn")) {
      node.textContent = node.dataset.defaultLabel;
    }
  });
  if (!busy) {
    refreshBusyStartedAt = 0;
    return;
  }
  refreshBusyStartedAt = Date.now();
  renderRefreshButtonsBusyState();
  refreshBusyTimer = window.setInterval(renderRefreshButtonsBusyState, 1000);
}

function showFlashWithOptions(message, tone = "info", options = {}) {
  const slot = document.getElementById("flash");
  if (!slot) return;
  if (flashTimer) clearTimeout(flashTimer);
  flashTimer = null;
  slot.innerHTML = message ? `<div class="flash ${esc(tone)}">${esc(message)}</div>` : "";
  if (message && options.persist !== true) {
    const durationMs = Number(options.durationMs || 4400);
    flashTimer = setTimeout(() => {
      slot.innerHTML = "";
    }, durationMs);
  }
}

showFlash = showFlashWithOptions;

function setTopbarLabel(view) {
  const labels = {
    home: "Tonight's Plan",
    schoolwork: "All Schoolwork",
    admin: "System Health",
  };
  const el = document.getElementById("topbarViewLabel");
  if (el) el.textContent = labels[view] || view;
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
      const bucket =
        row.displayCategory === "pending"
          ? "pending"
          : row.displayCategory === "ignored"
            ? "ignored"
            : row.dueCategory === "upcoming"
              ? "upcoming"
              : "actionable";
      groups[bucket].push(row);
      return groups;
    },
    { actionable: [], upcoming: [], pending: [], ignored: [] }
  );
}

function assignmentSurfaceId(key) {
  return `surface-assignment-${safeId(key)}`;
}

function taskSurfaceId(id) {
  return `surface-task-${safeId(id)}`;
}

function updateNavBadges() {
  const home = document.getElementById("navBadgeHome");
  const schoolwork = document.getElementById("navBadgeSchoolwork");
  if (home) home.textContent = state.home?.summary?.tonightCount > 0 ? String(state.home.summary.tonightCount) : "";
  if (schoolwork) schoolwork.textContent = state.assignments?.summary?.total > 0 ? String(state.assignments.summary.total) : "";
}

function syncNavActive() {
  document.querySelectorAll(".nav-item[data-view]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === state.activeView);
  });
  setTopbarLabel(state.activeView);
  updateNavBadges();
}

function updateSystemStatusDot() {
  const dot = document.getElementById("systemStatusDot");
  if (!dot) return;
  const services = state.health?.services || [];
  const managedAlerts = state.health?.managedAgents?.alerts || [];
  const allOk = services.length > 0 && services.every((s) => s.ok);
  const anyDown = services.some((s) => !s.ok && s.state !== "stale");
  const anyManagedError = managedAlerts.some((alert) => alert.severity === "error");
  const cls = !state.health ? "gray" : anyDown || anyManagedError ? "red" : allOk && managedAlerts.length === 0 ? "green" : "amber";
  dot.className = `status-dot ${cls}`;
  dot.title = !state.health ? "Health unknown" : anyDown ? "Services down — click for details" : allOk ? "All services healthy" : "Some services stale";
  dot.title = !state.health ? "Health unknown" : anyDown || anyManagedError ? "Services or managed agent need review - click for details" : allOk && managedAlerts.length === 0 ? "All services healthy" : "Some services stale or managed agent alerts present";
}

function renderMetricRow() {
  const root = document.getElementById("metricRow");
  if (!root) return;
  const tonight = state.home?.summary?.tonightCount ?? "—";
  const tonightTaskRows = (state.home?.sections?.tonight?.rows || []).filter((r) => r.kind === "task");
  const todayTaskCount = tonightTaskRows.length;
  const overdueTaskCount = tonightTaskRows.filter((r) => r.isOverdue).length;
  root.innerHTML = `
    <div class="metric-row">
      <div class="metric-card">
        <div class="metric-card-top">
          <span class="metric-card-label">Action Required</span>
          <div class="metric-icon red">
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6.5 2v4M6.5 9.5h.01"/><circle cx="6.5" cy="6.5" r="5.5"/></svg>
          </div>
        </div>
        <div class="metric-value">${esc(String(tonight))}</div>
        <div class="metric-footer">
          <span class="metric-delta neutral">tonight</span>
          need attention
        </div>
      </div>

      <div class="metric-card">
        <div class="metric-card-top">
          <span class="metric-card-label">Reminders Today</span>
          <div class="metric-icon amber">
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="6.5" cy="6.5" r="5.5"/><path d="M6.5 4v3l2 1"/></svg>
          </div>
        </div>
        <div class="metric-value">${esc(String(todayTaskCount))}</div>
        <div class="metric-footer">
          <span class="metric-delta neutral">${esc(String(overdueTaskCount))} missed</span>
          due today
        </div>
      </div>
    </div>
  `;
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

function syncOutcomeSelectionState(form) {
  if (!(form instanceof HTMLFormElement)) return;
  form.querySelectorAll(".outcome-option").forEach((option) => {
    option.classList.toggle("is-selected", option.querySelector("input[type='radio']")?.checked === true);
  });
}

function captureDrawerSnapshot() {
  if (!state.drawer.kind || state.drawer.loading) return null;
  const root = document.getElementById("drawerContent");
  if (!(root instanceof HTMLElement)) return null;
  const active = document.activeElement instanceof HTMLElement && root.contains(document.activeElement)
    ? document.activeElement
    : null;
  const forms = {};
  root.querySelectorAll("form[data-form]").forEach((form) => {
    if (!(form instanceof HTMLFormElement)) return;
    const formKey = form.getAttribute("data-form");
    if (!formKey) return;
    forms[formKey] = Object.fromEntries(new FormData(form).entries());
  });
  return {
    kind: state.drawer.kind,
    key: state.drawer.key,
    id: state.drawer.id,
    forms,
    active: active
      ? {
          id: active.id || null,
          name: active.getAttribute("name") || null,
          tagName: active.tagName,
          action: active.getAttribute("data-action") || null,
          section: active.getAttribute("data-section") || null,
          dataId: active.getAttribute("data-id") || null,
          status: active.getAttribute("data-status") || null,
          drawerInitial: active.getAttribute("data-drawer-initial") || null,
          value: "value" in active ? active.value : null,
          selectionStart: typeof active.selectionStart === "number" ? active.selectionStart : null,
          selectionEnd: typeof active.selectionEnd === "number" ? active.selectionEnd : null,
        }
      : null,
  };
}

function applySnapshotToForm(form, values) {
  if (!(form instanceof HTMLFormElement) || !values) return;
  for (const [name, value] of Object.entries(values)) {
    const controls = Array.from(form.elements).filter((el) => el instanceof HTMLElement && "name" in el && el.name === name);
    if (controls.length === 0) continue;
    const first = controls[0];
    if (first instanceof HTMLInputElement && first.type === "radio") {
      controls.forEach((control) => {
        if (control instanceof HTMLInputElement) control.checked = control.value === String(value);
      });
      syncOutcomeSelectionState(form);
      continue;
    }
    if (first instanceof HTMLInputElement && first.type === "checkbox") {
      controls.forEach((control) => {
        if (control instanceof HTMLInputElement) control.checked = value === "true" || value === "1" || value === "on";
      });
      continue;
    }
    controls.forEach((control) => {
      if ("value" in control) control.value = String(value ?? "");
    });
  }
}

function restoreDrawerSnapshot(snapshot) {
  if (!snapshot || !state.drawer.kind || state.drawer.loading) return;
  if (snapshot.kind !== state.drawer.kind || snapshot.key !== state.drawer.key || snapshot.id !== state.drawer.id) return;
  const root = document.getElementById("drawerContent");
  if (!(root instanceof HTMLElement)) return;
  for (const [formKey, values] of Object.entries(snapshot.forms || {})) {
    const form = root.querySelector(`form[data-form="${formKey}"]`);
    applySnapshotToForm(form, values);
  }
  if (!snapshot.active) return;
  const target = snapshot.active.id ? document.getElementById(snapshot.active.id) : null;
  let focusTarget = target instanceof HTMLElement ? target : null;
  if (!focusTarget && snapshot.active.action) {
    const selectors = [`[data-action="${snapshot.active.action}"]`];
    if (snapshot.active.section) selectors.push(`[data-section="${snapshot.active.section}"]`);
    if (snapshot.active.dataId) selectors.push(`[data-id="${snapshot.active.dataId}"]`);
    if (snapshot.active.status) selectors.push(`[data-status="${snapshot.active.status}"]`);
    focusTarget = root.querySelector(selectors.join(""));
  }
  if (!focusTarget && snapshot.active.drawerInitial === "1") {
    focusTarget = root.querySelector('[data-action="close-drawer"]');
  }
  if (!focusTarget && snapshot.active.name) {
    const candidates = Array.from(root.querySelectorAll(`[name="${snapshot.active.name}"]`));
    focusTarget =
      candidates.find((el) => el instanceof HTMLElement && snapshot.active.value != null && "value" in el && el.value === snapshot.active.value) ||
      candidates.find((el) => el instanceof HTMLElement) ||
      null;
  }
  if (!(focusTarget instanceof HTMLElement)) return;
  focusTarget.focus();
  if (
    typeof focusTarget.setSelectionRange === "function" &&
    snapshot.active.selectionStart != null &&
    snapshot.active.selectionEnd != null
  ) {
    try {
      focusTarget.setSelectionRange(snapshot.active.selectionStart, snapshot.active.selectionEnd);
    } catch {
      // ignore selection restore failures
    }
  }
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
  const surfaceId = assignmentSurfaceId(`${surface}-${item.key}`);
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
  const surfaceId = taskSurfaceId(`${surface}-${task.id}`);
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


function dueCls(row) {
  const dueCategory = String(row.dueCategory || "").toLowerCase();
  if (dueCategory === "overdue") return "overdue";
  if (dueCategory === "today") return "today";
  if (dueCategory === "upcoming" || dueCategory === "undated") return "";
  if (!row.dueDateYmd) return "";
  const today = new Date().toISOString().slice(0, 10);
  if (row.dueDateYmd < today) return "overdue";
  if (row.dueDateYmd === today) return "today";
  return "";
}

function dueDateLabel(row) {
  if (!row.dueDateLabel || row.dueDateLabel === "No due date") return "";
  return row.dueDateLabel;
}

function pillForRow(row) {
  if (row.displayCategory === "pending") return { cls: "gray", label: row.displayStatusLabel || "Waiting" };
  const dc = dueCls(row);
  if (dc === "overdue") return { cls: "red", label: "Overdue" };
  if (dc === "today") return { cls: "amber", label: "Tonight" };
  return { cls: "blue", label: row.displayStatusLabel || "This week" };
}

function renderAssignRow(row, surface = "home") {
  const rowId = assignmentSurfaceId(`${surface}-${row.key}`);
  const dCls = dueCls(row);
  const dLabel = dueDateLabel(row);
  const pill = pillForRow(row);
  const isWaiting = row.displayCategory === "pending";
  const dueSvg = dLabel ? `<svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="5.5" cy="5.5" r="4.5"/><path d="M5.5 3v2.5l1.5 1.5"/></svg>` : "";
  return `
    <div
      id="${esc(rowId)}"
      class="assign-row${isWaiting ? " is-waiting" : ""}"
      data-open-assignment-key="${esc(row.key)}"
      data-surface-card="assignment"
      tabindex="0"
      role="button"
      aria-label="Review ${esc(row.title)}"
    >
      <div class="assign-check"></div>
      <div class="assign-body">
        <div class="assign-title">${esc(row.title)}</div>
        <div class="assign-meta">
          <span class="assign-course">${esc(shortenCourseLabel(row.course))}</span>
          ${dLabel ? `<span class="assign-due ${dCls}">${dueSvg}${esc(dLabel)}</span>` : ""}
        </div>
      </div>
      <div class="assign-trail">
        <span class="pill ${pill.cls}">${esc(pill.label)}</span>
      </div>
    </div>
  `;
}

function renderTaskRow(task, surface = "home") {
  const rowId = taskSurfaceId(`${surface}-task-${task.id}`);
  const isOverdue = task.isOverdue;
  const isToday = task.isToday;
  const dotCls = isOverdue ? "red" : isToday ? "amber" : "blue";
  const timeLabel = isOverdue ? "Overdue" : isToday ? "Today" : esc(task.remindAtLabel || "");
  return `
    <div
      id="${esc(rowId)}"
      class="task-row"
      data-open-task-id="${esc(task.id)}"
      data-surface-card="task"
      tabindex="0"
      role="button"
      aria-label="Review ${esc(task.title)}"
    >
      <div class="task-dot ${dotCls}"></div>
      <span class="task-text">${esc(task.title)}</span>
      <span class="task-time">${timeLabel}</span>
    </div>
  `;
}

function renderReminderRow(task, surface = "home") {
  const rowId = taskSurfaceId(`${surface}-reminder-${task.id}`);
  const isOverdue = task.isOverdue;
  const timeLabel = isOverdue ? "Missed" : esc(task.remindAtLabel || "Today");
  return `
    <div
      id="${esc(rowId)}"
      class="reminder-row${isOverdue ? " is-overdue" : ""}"
      data-open-task-id="${esc(task.id)}"
      data-surface-card="task"
      tabindex="0"
      role="button"
      aria-label="Review ${esc(task.title)}"
    >
      <div class="reminder-icon${isOverdue ? " overdue" : ""}">
        <svg width="12" height="12" viewBox="0 0 13 13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="6.5" cy="6.5" r="5.5"/><path d="M6.5 4v2.5l2 1"/></svg>
      </div>
      <span class="reminder-title">${esc(task.title)}</span>
      <span class="reminder-time${isOverdue ? " overdue" : ""}">${timeLabel}</span>
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" class="reminder-chevron"><path d="M4 2l4 4-4 4"/></svg>
    </div>
  `;
}

function renderHomeSectionRows(sectionKey, surface = sectionKey) {
  const section = currentHomeSection(sectionKey);
  const rows = Array.isArray(section.rows) ? section.rows : [];
  if (rows.length === 0) return "";
  return rows.map((row) => (row.kind === "task" ? renderTaskRow(row, surface) : renderAssignRow(row, surface))).join("");
}

function renderHomeRightCol() {
  const assignments = state.health?.assignments || {};
  const services = state.health?.services || [];
  const activity = state.health?.activity || {};
  const schedule = state.health?.schedule || {};
  const allPendingTasks = Array.isArray(state.tasks?.rows) ? state.tasks.rows.filter((t) => t.status === "pending") : [];
  const futureTaskRows = allPendingTasks.filter((t) => !t.isToday && !t.isOverdue);
  const todayTaskCount = allPendingTasks.filter((t) => t.isToday || t.isOverdue).length;
  const totalMissing = assignments.totalMissing || 0;
  const handled = assignments.ignored || 0;
  const pct = totalMissing > 0 ? Math.round(((handled + (assignments.waiting || 0)) / totalMissing) * 100) : 0;

  const serviceRows = services
    .map((s) => {
      const indCls = s.ok ? "green" : s.state === "stale" ? "amber" : "red";
      const pillCls = s.ok ? "ok" : s.state === "stale" ? "stale" : "down";
      return `
        <div class="service-row">
          <div class="service-indicator ${indCls}"></div>
          <span class="service-name">${esc(s.label)}</span>
          <span class="service-age">${esc(s.ageLabel)}</span>
          <span class="service-status-pill ${pillCls}">${String(s.state || "down").toUpperCase()}</span>
        </div>
      `;
    })
    .join("");

  const allOk = services.length > 0 && services.every((s) => s.ok);
  const syncStale = activity.scrapeStale;

  const activityItems = [
    activity.lastScrapeAt
      ? { color: "purple", icon: `<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M1 6A5 5 0 0 1 9.6 2.5M11 6A5 5 0 0 1 2.4 9.5"/><path d="M9 1l.6 1.5-1.5.6M3 10l-.6-1.5 1.5-.6"/></svg>`, text: `Schoology <strong>sync completed</strong>`, time: esc(activity.lastScrapeLabel) }
      : null,
    activity.lastSummaryAt
      ? { color: "blue", icon: `<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M2 3h8M2 6h6M2 9h4"/></svg>`, text: `Daily summary <strong>sent via Telegram</strong>`, time: esc(activity.lastSummaryLabel) }
      : null,
  ].filter(Boolean);

  const activityHtml = activityItems.length === 0
    ? `<p class="empty-state">No recent activity recorded.</p>`
    : activityItems.map((item) => `
        <div class="activity-item">
          <div class="activity-icon ${item.color}">${item.icon}</div>
          <div class="activity-body">
            <div class="activity-text">${item.text}</div>
            <div class="activity-time">${item.time}</div>
          </div>
        </div>
      `).join("");

  const scheduleRows = [
    { label: "Scrape Schoology", value: schedule.scrapeCron || "—" },
    { label: "Daily summary", value: schedule.sendCron || "—" },
    { label: "Due reminders", value: schedule.reminderCron || "—" },
    schedule.liveChecksEnabled ? { label: "Live check", value: schedule.liveCheckCron || "—" } : null,
  ].filter(Boolean);

  const taskPanelRows = futureTaskRows.slice(0, 5);

  return `
    <div class="right-col">

      <!-- Upcoming Reminders -->
      <div class="panel">
        <div class="panel-header">
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="var(--ink-3)" stroke-width="1.8" stroke-linecap="round"><circle cx="7.5" cy="7.5" r="6"/><path d="M7.5 4.5v3.5l2 1.5"/></svg>
          <span class="panel-title">Upcoming Reminders</span>
          <span class="panel-count">${futureTaskRows.length}</span>
          <button type="button" class="panel-action" data-action="new-task">+ Add</button>
        </div>
        ${taskPanelRows.length === 0
          ? `<div class="empty-state">${todayTaskCount > 0 ? "Today's reminders are in the plan." : "No upcoming reminders."}</div>`
          : taskPanelRows.map((row) => renderTaskRow(row, "home-right")).join("")}
      </div>

      <!-- Assignment Overview -->
      <div class="panel">
        <div class="panel-header">
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="var(--ink-3)" stroke-width="1.8" stroke-linecap="round"><path d="M2 12V3h11v9M2 12h11M5 6h5M5 9h3"/></svg>
          <span class="panel-title">Assignment Overview</span>
        </div>
        <div class="progress-row">
          <div class="mini-stat">
            <div class="mini-stat-label">Actionable</div>
            <div class="mini-stat-value" style="color:var(--red)">${esc(String(assignments.actionable || 0))}</div>
          </div>
          <div class="mini-stat">
            <div class="mini-stat-label">Waiting</div>
            <div class="mini-stat-value" style="color:var(--amber)">${esc(String(assignments.waiting || 0))}</div>
          </div>
          <div class="mini-stat">
            <div class="mini-stat-label">Ignored</div>
            <div class="mini-stat-value" style="color:var(--ink-3)">${esc(String(handled))}</div>
          </div>
          <div class="mini-stat">
            <div class="mini-stat-label">Total Missing</div>
            <div class="mini-stat-value">${esc(String(totalMissing))}</div>
          </div>
        </div>
        <div style="padding: 0 18px 14px;">
          <div class="progress-label" style="margin-bottom:6px;">
            <span style="font-size:12px;font-weight:600;color:var(--ink-3);">Coverage this session</span>
            <span class="progress-pct">${pct}%</span>
          </div>
          <div class="progress-track">
            <div class="progress-fill brand" style="width:${pct}%"></div>
          </div>
        </div>
      </div>

      <!-- Recent Activity -->
      <div class="panel">
        <div class="panel-header">
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="var(--ink-3)" stroke-width="1.8" stroke-linecap="round"><path d="M7.5 2a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11ZM7.5 5v3l2 1"/></svg>
          <span class="panel-title">Recent Activity</span>
        </div>
        <div class="activity-list">${activityHtml}</div>
      </div>

      <!-- Schedule -->
      ${scheduleRows.length > 0 ? `
      <div class="panel">
        <div class="panel-header">
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="var(--ink-3)" stroke-width="1.8" stroke-linecap="round"><rect x="2" y="3" width="11" height="10" rx="1.5"/><path d="M5 3V1.5M10 3V1.5M2 7h11"/></svg>
          <span class="panel-title">Schedule</span>
        </div>
        <div class="schedule-rows">
          ${scheduleRows.map((row, i) => `<div class="schedule-row${i > 0 ? "" : ""}"><span class="schedule-row-label">${esc(row.label)}</span><span class="schedule-row-value">${esc(row.value)}</span></div>`).join("")}
        </div>
      </div>` : ""}

    </div>
  `;
}

function renderHomePane() {
  const root = document.getElementById("homePane");
  if (!root) return;
  if (!state.home) {
    root.innerHTML = `<p class="empty-state">Loading your after-school plan...</p>`;
    return;
  }

  const tonight = currentHomeSection("tonight");
  const waiting = currentHomeSection("waiting");
  const comingUp = currentHomeSection("comingUp");
  const handled = currentHomeSection("handled");

  const tonightRows = Array.isArray(tonight.rows) ? tonight.rows : [];
  const waitingRows = Array.isArray(waiting.rows) ? waiting.rows : [];
  const comingUpRows = Array.isArray(comingUp.rows) ? comingUp.rows : [];
  const handledRows = Array.isArray(handled.rows) ? handled.rows : [];

  const overdueAssignRows = tonightRows.filter((r) => r.kind === "assignment" && dueCls(r) === "overdue");
  const missedReminderRows = tonightRows.filter((r) => r.kind === "task" && r.isOverdue);
  const todayAssignRows = tonightRows.filter((r) => r.kind === "assignment" && dueCls(r) !== "overdue");
  const todayTaskRows = tonightRows.filter((r) => r.kind === "task" && !r.isOverdue);

  const assignmentCount = tonightRows.filter((r) => r.kind === "assignment").length;
  const todayReminderCount = tonightRows.filter((r) => r.kind === "task").length;
  const actionableCount = tonightRows.length;

  const now = new Date();
  const dateLabel = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  // Progress: handled + waiting out of total
  const totalActive = actionableCount + waitingRows.length + handledRows.length;
  const resolvedCount = waitingRows.length + handledRows.length;
  const progressPct = totalActive > 0 ? Math.round((resolvedCount / totalActive) * 100) : 0;

  root.innerHTML = `
    <div class="page-header">
      <div class="page-title-group">
        <div class="page-date">${esc(dateLabel)}</div>
        <h1 class="page-title">Good ${now.getHours() < 12 ? "morning" : now.getHours() < 17 ? "afternoon" : "evening"}.</h1>
        <p class="page-subtitle">${
          actionableCount === 0
            ? "All caught up — nothing needs attention tonight."
            : [
                assignmentCount > 0 ? `${assignmentCount} assignment${assignmentCount === 1 ? "" : "s"}` : "",
                todayReminderCount > 0 ? `${todayReminderCount} reminder${todayReminderCount === 1 ? "" : "s"}` : "",
              ].filter(Boolean).join(" and ") + " need attention tonight."
        }</p>
      </div>
    </div>

    <div class="dashboard-grid">

      <!-- LEFT COLUMN -->
      <div class="left-col">

        <!-- Tonight's Assignments -->
        <div class="panel">
          <div class="panel-header">
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="var(--ink-3)" stroke-width="1.8" stroke-linecap="round"><rect x="2" y="2" width="11" height="11" rx="2"/><path d="M5 7.5h5M5 5h5M5 10h3"/></svg>
            <span class="panel-title">Tonight's Plan</span>
            <span class="panel-count">${actionableCount} item${actionableCount === 1 ? "" : "s"}</span>
            <button type="button" class="panel-action" data-action="switch-view" data-view="schoolwork">View all</button>
          </div>

          ${overdueAssignRows.length > 0 ? `
            <div class="section-header">
              <div class="section-dot red"></div>
              <span class="section-name">Overdue</span>
              <span class="section-count">${overdueAssignRows.length}</span>
            </div>
            ${overdueAssignRows.map((row) => renderAssignRow(row, "home-overdue")).join("")}
          ` : ""}

          ${missedReminderRows.length > 0 ? `
            <div class="section-header reminder-section-header missed">
              <div class="section-dot red"></div>
              <span class="section-name">Missed Reminders</span>
              <span class="section-count">${missedReminderRows.length}</span>
            </div>
            ${missedReminderRows.map((row) => renderReminderRow(row, "home-missed")).join("")}
          ` : ""}

          ${(todayAssignRows.length > 0 || todayTaskRows.length > 0) ? `
            <div class="section-header">
              <div class="section-dot amber"></div>
              <span class="section-name">Due Tonight</span>
              <span class="section-count">${todayAssignRows.length + todayTaskRows.length}</span>
            </div>
            ${todayAssignRows.map((row) => renderAssignRow(row, "home-today")).join("")}
            ${todayTaskRows.map((row) => renderReminderRow(row, "home-today")).join("")}
          ` : ""}

          ${waitingRows.length > 0 ? `
            <div class="section-header">
              <div class="section-dot gray"></div>
              <span class="section-name">Waiting on Teacher</span>
              <span class="section-count">${waitingRows.length}</span>
            </div>
            ${waitingRows.map((row) => row.kind === "task" ? renderTaskRow(row, "home-waiting") : renderAssignRow(row, "home-waiting")).join("")}
          ` : ""}

          ${comingUpRows.length > 0 ? `
            <div class="section-header">
              <div class="section-dot blue"></div>
              <span class="section-name">Coming Up</span>
              <span class="section-count">${comingUpRows.length}</span>
            </div>
            ${comingUpRows.map((row) => row.kind === "task" ? renderTaskRow(row, "home-coming-up") : renderAssignRow(row, "home-coming-up")).join("")}
          ` : ""}

          ${actionableCount === 0 && waitingRows.length === 0 && comingUpRows.length === 0
            ? `<div class="empty-state">All caught up — nothing needs attention tonight.</div>`
            : ""}

          <!-- Progress bar -->
          <div class="progress-section">
            <div class="progress-label">
              <span>Tonight's progress</span>
              <span class="progress-pct">${resolvedCount} of ${totalActive} resolved</span>
            </div>
            <div class="progress-track">
              <div class="progress-fill ${progressPct >= 80 ? "green" : progressPct >= 40 ? "amber" : "red"}" style="width:${progressPct}%"></div>
            </div>
          </div>
        </div>

      </div><!-- /left-col -->

      ${renderHomeRightCol()}

    </div><!-- /dashboard-grid -->
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
            ${renderSchoolworkGroup("Coming up", "Future-due assignments to keep on the radar.", groups.upcoming, "No future-due assignments match this view.", "upcoming")}
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
  const services = state.health.services || [];
  const activity = state.health.activity || {};
  const assignments = state.health.assignments || {};
  const tasks = state.health.tasks || {};
  const managedAgents = state.health.managedAgents || {};
  const allOk = services.length > 0 && services.every((s) => s.ok) && (managedAgents.alerts || []).length === 0;

  const serviceRows = services.map((s) => {
    const indCls = s.ok ? "green" : s.state === "stale" ? "amber" : "red";
    const pillCls = s.ok ? "ok" : s.state === "stale" ? "stale" : "down";
    return `
      <div class="service-row">
        <div class="service-indicator ${indCls}"></div>
        <span class="service-name">${esc(s.label)}</span>
        <span class="service-age">${esc(s.lastSeenLabel)}</span>
        <span class="service-status-pill ${pillCls}">${String(s.state || "down").toUpperCase()}</span>
      </div>
    `;
  }).join("");

  const managedAlertRows = (managedAgents.alerts || []).map((alert) => {
    const cls = alert.severity === "error" ? "red" : "amber";
    return `<div class="managed-alert ${cls}">${esc(alert.message || "")}</div>`;
  }).join("");
  const managedSessionRows = (managedAgents.recentSessions || []).slice(0, 4).map((session) => {
    const failed = session.status && session.status !== "active";
    const risk = failed || session.idleExpired || session.costRisk || session.isExpired;
    const flag = session.idleExpired
      ? "Idle expired"
      : session.isExpired
        ? "TTL expired"
        : failed
          ? String(session.status || "Error").toUpperCase()
          : session.costRisk
            ? "Cost risk"
            : "OK";
    return `
      <div class="managed-row">
        <div>
          <div class="managed-row-title">${esc(session.sessionId || "No session")}</div>
          <div class="managed-row-sub">${esc(session.lastEventType || session.createReason || "No events yet")}</div>
        </div>
        <span class="pill ${risk ? "amber" : "green"}">${esc(flag)}</span>
      </div>
    `;
  }).join("");
  const managedEventRows = (managedAgents.recentEvents || []).slice(0, 5).map((event) => {
    const cls = event.status === "error" ? "red" : event.status === "blocked" || event.status === "warning" ? "amber" : "green";
    const created = String(event.createdAt || "").replace("T", " ").replace(".000Z", "Z");
    return `
      <div class="managed-row">
        <div>
          <div class="managed-row-title">${esc(event.eventType || "event")}</div>
          <div class="managed-row-sub">${esc(event.summary || created)}</div>
        </div>
        <span class="pill ${cls}">${esc(String(event.status || "ok").toUpperCase())}</span>
      </div>
    `;
  }).join("");
  const managedPanel = managedAgents.enabled ? `
        <div class="panel">
          <div class="panel-header">
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="var(--ink-3)" stroke-width="1.8" stroke-linecap="round"><path d="M3 12V3h9v9"/><path d="M5 5h5M5 8h3"/></svg>
            <span class="panel-title">Managed Agents</span>
            <span class="pill ${managedAgents.alerts?.length ? "amber" : "green"}" style="font-size:11px;padding:2px 8px;">${managedAgents.alerts?.length ? "Needs review" : "Nominal"}</span>
          </div>
          <div class="managed-agent-summary">
            <div class="mini-stat"><div class="mini-stat-label">Environment</div><div class="mini-stat-value small">${esc(managedAgents.environment || "dev")}</div></div>
            <div class="mini-stat"><div class="mini-stat-label">Active</div><div class="mini-stat-value small">${esc(String(managedAgents.activeSessionCount || 0))}</div></div>
            <div class="mini-stat"><div class="mini-stat-label">Idle policy</div><div class="mini-stat-value small">${managedAgents.idleTimeoutMinutes ? `${esc(String(managedAgents.idleTimeoutMinutes))}m` : "n/a"}</div></div>
          </div>
          ${managedAlertRows ? `<div class="managed-alert-list">${managedAlertRows}</div>` : ""}
          <div class="managed-section-title">Recent Sessions</div>
          <div class="managed-list">${managedSessionRows || `<p class="empty-state">No managed sessions recorded.</p>`}</div>
          <div class="managed-section-title">Recent Events</div>
          <div class="managed-list">${managedEventRows || `<p class="empty-state">No managed events recorded.</p>`}</div>
        </div>
  ` : "";

  root.innerHTML = `
    <div class="admin-header">
      <div>
        <h2 class="admin-title">System Health</h2>
        <p class="admin-subtitle">Service status, last sync, and Schoology refresh.</p>
      </div>
      <button type="button" class="btn btn-primary" data-action="refresh-assignments">
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M1 6.5A5.5 5.5 0 0 1 10.5 2.5M12 6.5A5.5 5.5 0 0 1 2.5 10.5"/><path d="M10.5 1.5l.7 1.5-1.5.7M3.5 11.5l-.7-1.5 1.5-.7"/></svg>
        Refresh Schoology
      </button>
    </div>

    <div class="dashboard-grid">
      <div class="left-col">

        <!-- Service Health -->
        <div class="panel">
          <div class="panel-header">
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="var(--ink-3)" stroke-width="1.8" stroke-linecap="round"><path d="M2 10l3-6 3 4 2-3 3 5"/></svg>
            <span class="panel-title">Services</span>
            <span class="pill ${allOk ? "green" : "amber"}" style="font-size:11px;padding:2px 8px;">${allOk ? "All OK" : "Issues detected"}</span>
          </div>
          <div class="service-list">${serviceRows || `<p class="empty-state">No services configured.</p>`}</div>
          <div class="sync-bar${activity.scrapeStale ? " stale" : ""}">
            <div class="sync-dot"></div>
            ${activity.scrapeStale ? "Sync may be stale" : "Heartbeat live · checking every 30s"}
            <span class="sync-bar-time">Last scrape: ${esc(activity.lastScrapeAgeLabel || "—")} ago</span>
          </div>
        </div>

        ${managedPanel}

        <!-- How it works -->
        <div class="panel">
          <div class="panel-header">
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="var(--ink-3)" stroke-width="1.8" stroke-linecap="round"><circle cx="7.5" cy="7.5" r="6"/><path d="M7.5 5v3.5l2 1.5"/></svg>
            <span class="panel-title">How It Works</span>
          </div>
          <ul class="plain-list" style="padding:14px 18px;">${(state.health.howItWorks || []).map((line) => `<li>${esc(line)}</li>`).join("")}</ul>
        </div>

        <!-- Quick commands -->
        <div class="panel">
          <div class="panel-header">
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="var(--ink-3)" stroke-width="1.8" stroke-linecap="round"><rect x="2" y="2" width="11" height="11" rx="2"/><path d="M5 5l2 2-2 2M9 9H8"/></svg>
            <span class="panel-title">Quick Commands</span>
          </div>
          <div class="command-list" style="padding:14px 18px;">${(state.health.quickCommands || []).map((cmd) => `<div class="mono-block">${esc(cmd)}</div>`).join("")}</div>
        </div>

      </div><!-- /left-col -->

      <div class="right-col">

        <!-- At a glance -->
        <div class="panel">
          <div class="panel-header">
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="var(--ink-3)" stroke-width="1.8" stroke-linecap="round"><path d="M2 12V3h11v9M2 12h11M5 6h5M5 9h3"/></svg>
            <span class="panel-title">At a Glance</span>
          </div>
          <div class="progress-row">
            <div class="mini-stat"><div class="mini-stat-label">Actionable</div><div class="mini-stat-value" style="color:var(--red)">${esc(String(assignments.actionable || 0))}</div></div>
            <div class="mini-stat"><div class="mini-stat-label">Waiting</div><div class="mini-stat-value" style="color:var(--amber)">${esc(String(assignments.waiting || 0))}</div></div>
            <div class="mini-stat"><div class="mini-stat-label">Tasks pending</div><div class="mini-stat-value">${esc(String(tasks.pending || 0))}</div></div>
            <div class="mini-stat"><div class="mini-stat-label">Tasks overdue</div><div class="mini-stat-value" style="color:var(--red)">${esc(String(tasks.overdue || 0))}</div></div>
          </div>
          <p class="activity-copy" style="padding:0 18px 14px;">
            Last scrape: <strong>${esc(activity.lastScrapeLabel || "Never")}</strong><br />
            Last summary: <strong>${esc(activity.lastSummaryLabel || "Never")}</strong>
          </p>
        </div>

        <!-- File state -->
        <div class="panel">
          <div class="panel-header">
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="var(--ink-3)" stroke-width="1.8" stroke-linecap="round"><path d="M4 2h5l4 4v8H4V2Z"/><path d="M9 2v4h4"/></svg>
            <span class="panel-title">File State</span>
          </div>
          <ul class="plain-list" style="padding:14px 18px;">
            ${(state.health.files || []).map((f) => `
              <li>
                <span style="font-weight:600;color:${f.exists ? "var(--green)" : "var(--red)"}">${esc(f.label)}</span>:
                ${f.exists ? "present" : "missing"}
                <br/><span class="cell-subtle">${esc(f.path)}</span>
              </li>
            `).join("")}
          </ul>
        </div>

        <!-- Docs -->
        <div class="panel">
          <div class="panel-header">
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="var(--ink-3)" stroke-width="1.8" stroke-linecap="round"><path d="M3 2h9v11H3ZM6 5h4M6 8h4M6 11h2"/></svg>
            <span class="panel-title">Documentation</span>
          </div>
          <ul class="plain-list" style="padding:14px 18px;">
            ${Object.values(state.health.docs || {}).map((v) => `<li><span class="mono-block" style="display:inline">${esc(v)}</span></li>`).join("")}
          </ul>
        </div>

      </div><!-- /right-col -->
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
  if (manual === "Will complete in class") return "will_complete_in_class";
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

function betaSection(key, label, valueText, bodyHtml) {
  const isOpen = state.drawer.section === key;
  const chevron = `<svg class="beta-chevron" width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3.5l3.5 3.5 3.5-3.5"/></svg>`;
  return `
    <div class="beta-section${isOpen ? " is-open" : ""}">
      <button type="button" class="beta-section-row" data-action="beta-toggle-section" data-section="${esc(key)}">
        <span class="beta-row-label">${esc(label)}</span>
        <span class="beta-row-value-wrap">
          <span class="beta-row-value">${valueText}</span>
          ${chevron}
        </span>
      </button>
      ${isOpen ? `<div class="beta-section-body">${bodyHtml}</div>` : ""}
    </div>
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

  const statusValue = esc(assignment.displayStatusLabel || assignment.bucketLabel || "No special status");
  const reminderValue = pendingReminder?.remindAtLabel
    ? `${esc(pendingReminder.remindAtLabel)}${pendingReminder.recurrenceLabel ? `<span class="beta-row-value-sub"> · ${esc(pendingReminder.recurrenceLabel)}</span>` : ""}`
    : `<span class="beta-row-value-empty">No reminder</span>`;
  const notesValue = notes.length > 0
    ? `${notes.length} note${notes.length === 1 ? "" : "s"}`
    : `<span class="beta-row-value-empty">No notes</span>`;

  root.innerHTML = `
    <div class="beta-drawer">
      <button type="button" class="beta-close-btn" data-action="close-drawer" data-drawer-initial="1" aria-label="Close">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M1 1l10 10M11 1L1 11"/></svg>
      </button>

      <div class="beta-header">
        <p class="beta-eyebrow">${esc(assignment.course || "Assignment")}</p>
        <h2 class="beta-title" id="drawerTitle">${esc(assignment.title || "Assignment")}</h2>
        <div class="beta-header-meta">
          <span class="status-pill ${statusClass(assignment.displayCategory)}">${esc(assignment.bucketLabel || "Needs attention")}</span>
          <span class="beta-meta-sep">·</span>
          <span class="beta-meta-due">${esc(assignment.dueDateLabel || assignment.dueDate || "No due date")}</span>
        </div>
        ${assignment.url ? `<a class="beta-schoology-link" href="${esc(assignment.url)}" target="_blank" rel="noreferrer">Open in Schoology →</a>` : ""}
        ${assignment.reasonText ? `<p class="beta-reason">${esc(truncate(assignment.reasonText, 100))}</p>` : ""}
      </div>

      ${betaSection("status", "Status", statusValue, `
        <form data-form="assignment-status">
          <input type="hidden" name="key" value="${esc(assignment.key)}" />
          <div class="outcome-grid">
            ${renderOutcomeOptions(currentAssignmentOutcome(assignment))}
          </div>
          <div class="beta-body-foot">
            <button type="submit" class="solid-button">Save</button>
          </div>
        </form>
      `)}

      ${betaSection("reminder", "Reminder", reminderValue, `
        <form data-form="assignment-drawer-reminder">
          <input type="hidden" name="key" value="${esc(assignment.key)}" />
          <input type="hidden" name="reminderId" value="${esc(reminderSeed.reminderId)}" />
          <div class="beta-two-col">
            <label class="field-label">
              Time
              <input class="field-input" type="datetime-local" name="remindAt" value="${esc(reminderSeed.remindAt)}" required />
            </label>
            <label class="field-label">
              Recurrence
              <select class="field-select" name="recurrence">${recurrenceOptionsMarkup(reminderSeed.recurrence)}</select>
            </label>
          </div>
          <label class="field-label">
            Note
            <input class="field-input" name="message" value="${esc(reminderSeed.message)}" placeholder="Optional" />
          </label>
          <div class="beta-body-foot">
            ${pendingReminder ? `<button type="button" class="beta-remove-link" data-action="delete-reminder" data-id="${esc(pendingReminder.id)}" data-key="${esc(assignment.key)}">Remove</button>` : ""}
            <button type="submit" class="solid-button">${pendingReminder ? "Update" : "Set reminder"}</button>
          </div>
        </form>
      `)}

      ${betaSection("notes", "Notes", notesValue, `
        ${notes.length > 0 ? `
          <div class="beta-notes-list">${notes.map((n) => `
            <div class="beta-note-item">
              <span class="beta-note-date">${esc(n.createdAt || "")}</span>
              <p class="beta-note-text">${esc(n.note)}</p>
            </div>`).join("")}
          </div>
        ` : ""}
        <form data-form="assignment-drawer-note">
          <input type="hidden" name="key" value="${esc(assignment.key)}" />
          <label class="field-label">
            <textarea class="field-textarea" name="note" placeholder="Add a note…" required></textarea>
          </label>
          <div class="beta-body-foot">
            <button type="submit" class="solid-button">Add note</button>
          </div>
        </form>
      `)}
    </div>
  `;
}

function renderTaskDrawer(root) {
  const task = state.drawer.data || {};
  const isEdit = state.drawer.mode === "edit";
  // For new tasks the form is always open; for edits use the accordion
  const isOpen = !isEdit || state.drawer.section === "details";
  const chevron = `<svg class="beta-chevron" width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3.5l3.5 3.5 3.5-3.5"/></svg>`;
  const detailsValue = isEdit
    ? esc(task.remindAtLabel || "No reminder time")
    : "";

  root.innerHTML = `
    <div class="beta-drawer">
      <button type="button" class="beta-close-btn" data-action="close-drawer" data-drawer-initial="1" aria-label="Close">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M1 1l10 10M11 1L1 11"/></svg>
      </button>

      <div class="beta-header">
        <p class="beta-eyebrow">${isEdit ? "Follow-up" : "New follow-up"}</p>
        <h2 class="beta-title" id="drawerTitle">${isEdit ? esc(task.title || "Edit follow-up") : "Add a follow-up"}</h2>
        ${isEdit ? `
          <div class="beta-task-status-row">
            <span class="beta-task-status-pill ${task.status === "done" ? "done" : "pending"}">${task.status === "done" ? "Completed" : "Pending"}</span>
            ${task.status === "done"
              ? `<button type="button" class="ghost-button beta-task-action" data-action="task-toggle-status" data-id="${esc(task.id)}" data-status="pending">Reopen</button>`
              : `<button type="button" class="ghost-button beta-task-action" data-action="task-toggle-status" data-id="${esc(task.id)}" data-status="done">Mark done</button>`}
            <button type="button" class="ghost-button beta-task-delete" data-action="delete-task" data-id="${esc(task.id)}">Delete</button>
          </div>
        ` : ""}
      </div>

      <div class="beta-section${isOpen ? " is-open" : ""}">
        ${isEdit ? `
          <button type="button" class="beta-section-row" data-action="beta-toggle-section" data-section="details">
            <span class="beta-row-label">Details</span>
            <span class="beta-row-value-wrap">
              <span class="beta-row-value">${detailsValue}</span>
              ${chevron}
            </span>
          </button>
        ` : ""}
        ${isOpen ? `
          <div class="beta-section-body">
            <form class="field-grid" data-form="task">
              <input type="hidden" name="id" value="${esc(task.id || "")}" />
              <label class="field-label">
                Title
                <input class="field-input" name="title" value="${esc(task.title || "")}" placeholder="Email math teacher" ${state.drawer.focus === "title" ? `data-autofocus="1"` : ""} required />
              </label>
              <div class="beta-two-col">
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
              <div class="beta-body-foot">
                <button type="submit" class="solid-button">${isEdit ? "Save" : "Create follow-up"}</button>
              </div>
            </form>
          </div>
        ` : ""}
      </div>
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
  const drawerSnapshot = captureDrawerSnapshot();
  const sequence = ++renderSequence;
  syncNavActive();
  updateSystemStatusDot();
  renderMetricRow();
  renderVisibility();
  renderHomePane();
  renderSchoolworkPane();
  renderAdminPane();
  renderDrawer();
  if (drawerSnapshot) {
    requestAnimationFrame(() => {
      if (sequence !== renderSequence) return;
      restoreDrawerSnapshot(drawerSnapshot);
    });
  }
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

function cssAttributeValue(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
}

function restoreFocus(surfaceId, fallback = {}) {
  if (!surfaceId && !fallback?.kind) return;
  requestAnimationFrame(() => {
    let target = surfaceId ? document.getElementById(surfaceId) : null;
    const activePanelSelector = `[data-view-panel="${cssAttributeValue(state.activeView)}"]:not([hidden])`;
    if (!(target instanceof HTMLElement) && fallback?.kind === "assignment" && fallback?.key) {
      target =
        document.querySelector(
          `${activePanelSelector} [data-open-assignment-key="${cssAttributeValue(fallback.key)}"]`
        ) ||
        document.querySelector(`[data-open-assignment-key="${cssAttributeValue(fallback.key)}"]`);
    }
    if (!(target instanceof HTMLElement) && fallback?.kind === "task" && fallback?.id) {
      target =
        document.querySelector(
          `${activePanelSelector} [data-open-task-id="${cssAttributeValue(fallback.id)}"]`
        ) ||
        document.querySelector(`[data-open-task-id="${cssAttributeValue(fallback.id)}"]`);
    }
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
  const requestId = ++assignmentDrawerRequestSeq;
  const nextFocus = options.focus ?? state.drawer.focus ?? null;
  const nextSection = options.section ?? state.drawer.section ?? (nextFocus === "reminder" ? "reminder" : nextFocus === "note" ? "notes" : "status");
  const returnFocusId = options.openerId ?? state.drawer.returnFocusId ?? null;
  const keepCurrentWhileLoading = Boolean(
    options.keepCurrentWhileLoading ?? (state.drawer.kind === "assignment" && state.drawer.key === key && state.drawer.data)
  );
  state.drawer = {
    kind: "assignment",
    key,
    id: null,
    data: keepCurrentWhileLoading ? state.drawer.data : null,
    loading: !keepCurrentWhileLoading,
    mode: "view",
    focus: nextFocus,
    section: nextSection,
    returnFocusId,
    requestId,
  };
  renderAll();
  try {
    const detail = await fetchJson(`/api/assignments/${encodeURIComponent(key)}/detail`);
    if (state.drawer.kind !== "assignment" || state.drawer.key !== key || state.drawer.requestId !== requestId) return;
    state.drawer = {
      ...state.drawer,
      data: detail,
      loading: false,
      mode: "view",
      focus: nextFocus,
      section: nextSection,
      returnFocusId,
      requestId,
    };
    renderAll();
    if (options.focusInitialTarget !== false) focusDrawerTarget();
  } catch (err) {
    if (state.drawer.kind === "assignment" && state.drawer.key === key && state.drawer.requestId === requestId) {
      state.drawer = {
        ...state.drawer,
        loading: false,
        requestId,
      };
      renderAll();
    }
    throw err;
  }
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
  if (options.focusInitialTarget !== false) focusDrawerTarget();
}

function closeDrawer() {
  const returnFocusId = state.drawer.returnFocusId;
  const returnFocusFallback = {
    kind: state.drawer.kind,
    key: state.drawer.key,
    id: state.drawer.id,
  };
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
  restoreFocus(returnFocusId, returnFocusFallback);
}

async function refreshAssignmentViews(key = null) {
  await Promise.all([loadHome(), loadAssignments()]);
  if (state.drawer.kind === "assignment" && (state.drawer.key || key)) {
    await openAssignmentDrawer(key || state.drawer.key, {
      focus: state.drawer.focus || null,
      section: state.drawer.section || "status",
      openerId: state.drawer.returnFocusId || null,
      keepCurrentWhileLoading: true,
      focusInitialTarget: false,
    });
  }
}

async function refreshTaskViews(id = null) {
  await Promise.all([loadHome(), loadTasks()]);
  if (state.drawer.kind === "task" && (state.drawer.id || id)) {
    const nextTask = findTaskById(id || state.drawer.id);
    if (nextTask) {
      openTaskDrawer(nextTask, { openerId: state.drawer.returnFocusId || null, focusInitialTarget: false });
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
      keepCurrentWhileLoading: true,
      focusInitialTarget: false,
    });
  } else if (state.drawer.kind === "task" && state.drawer.id) {
    const task = findTaskById(state.drawer.id);
    if (task) openTaskDrawer(task, { openerId: state.drawer.returnFocusId || null, focusInitialTarget: false });
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
  })
    .then((output) => (output?.ok === false ? { ok: false, error: new Error(output.error || "Note add failed.") } : { ok: true, output }))
    .catch((error) => ({ ok: false, error }));
  const statusResult = await runTool("update_assignment_status", {
    key,
    status: "E",
  })
    .then((output) => (output?.ok === false ? { ok: false, error: new Error(output.error || "Status update failed.") } : { ok: true, output }))
    .catch((error) => ({ ok: false, error }));
  await refreshAssignmentViews(key);
  if (noteResult.ok === false && statusResult.ok === false) {
    showFlash(`${noteResult.error?.message || "Note add failed."} ${statusResult.error?.message || "Status update failed."}`.trim(), "error");
    return false;
  }
  if (noteResult.ok === false || statusResult.ok === false) {
    const successes = [];
    const failures = [];
    if (noteResult.ok !== false) successes.push("note saved");
    else failures.push(`note failed: ${noteResult.error?.message || String(noteResult.error || "unknown error")}`);
    if (statusResult.ok !== false) successes.push("status set to waiting on teacher");
    else failures.push(`status failed: ${statusResult.error?.message || String(statusResult.error || "unknown error")}`);
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
    will_complete_in_class: "F",
    none: "",
  };
  const outcomeToMessage = {
    waiting_teacher: "Marked as waiting on teacher.",
    excused: "Marked as excused.",
    practice_only: "Marked as practice only.",
    let_it_go: "Marked to let go.",
    grade_not_posted: "Marked as grade not posted yet.",
    will_complete_in_class: "Marked as will complete in class.",
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

async function refreshSchoologyWithProgress() {
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
        keepCurrentWhileLoading: true,
        focusInitialTarget: false,
      });
    }
    showFlash(refreshSuccessMessage(output), "success");
  } finally {
    setRefreshButtonsBusy(false);
  }
}

async function refreshSchoology() {
  const startedAt = Date.now();
  setRefreshButtonsBusy(true);
  showFlash("Refreshing Schoology. This can take up to a minute.", "info", { persist: true });
  try {
    const output = await runTool("refresh_schoology", {});
    if (output.ok === false) {
      showFlash(
        `Schoology refresh failed after ${formatElapsedLabel(Date.now() - startedAt)}. ${
          output.error || "Please try again."
        }`,
        "error",
        { durationMs: 12000 }
      );
      return;
    }
    await Promise.all([loadHome(), loadAssignments(), loadHealth(), loadTasks()]);
    if (state.drawer.kind === "assignment" && state.drawer.key) {
      await openAssignmentDrawer(state.drawer.key, {
        focus: state.drawer.focus || null,
        section: state.drawer.section || "status",
        openerId: state.drawer.returnFocusId || null,
        keepCurrentWhileLoading: true,
        focusInitialTarget: false,
      });
    }
    showFlash(
      `${refreshSuccessMessage(output)} Finished in ${formatElapsedLabel(Date.now() - startedAt)}.`,
      "success",
      { durationMs: 12000 }
    );
  } catch (error) {
    showFlash(
      `Schoology refresh failed after ${formatElapsedLabel(Date.now() - startedAt)}. ${
        error?.message || String(error)
      }`,
      "error",
      { durationMs: 12000 }
    );
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
  if (!(target instanceof Element)) return;
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
        updateNavBadges();
        return;
      }
      if (action === "toggle-assignment-select") {
        const key = actionTarget.getAttribute("data-key");
        if (!key) return;
        if (actionTarget.checked) state.selectedAssignmentKeys.add(key);
        else state.selectedAssignmentKeys.delete(key);
        renderSchoolworkPane();
        updateNavBadges();
        return;
      }
      if (action === "select-visible-assignments") {
        filteredAssignmentRows().forEach((row) => state.selectedAssignmentKeys.add(row.key));
        renderSchoolworkPane();
        updateNavBadges();
        return;
      }
      if (action === "clear-assignment-selection") {
        state.selectedAssignmentKeys.clear();
        renderSchoolworkPane();
        updateNavBadges();
        return;
      }
      if (action === "apply-bulk-status") return await handleBulkStatusApply();
      if (action === "delete-reminder") return await deleteReminder(actionTarget.getAttribute("data-id"), actionTarget.getAttribute("data-key"));
      if (action === "new-task") return openTaskDrawer(null, { focus: "title" });
      if (action === "task-toggle-status") return await toggleTaskStatus(actionTarget.getAttribute("data-id"), actionTarget.getAttribute("data-status"));
      if (action === "delete-task") return await deleteTask(actionTarget.getAttribute("data-id"));
      if (action === "beta-toggle-section") {
        const section = actionTarget.getAttribute("data-section");
        const snapshot = captureDrawerSnapshot();
        state.drawer.section = state.drawer.section === section ? null : section;
        renderDrawer();
        restoreDrawerSnapshot(snapshot);
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
    return;
  }
  if (target.name === "outcome") {
    const form = target.closest('form[data-form="assignment-status"]');
    if (form instanceof HTMLFormElement) {
      syncOutcomeSelectionState(form);
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
  }
}

init();
