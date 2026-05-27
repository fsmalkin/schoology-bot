# Dashboard UAT Bug Log — 2026-05-26

Companion to [docs/DASHBOARD_REDTEAM.md](DASHBOARD_REDTEAM.md). This document is the result of **actually running the app and exercising every flow**, not theoretical critique.

## Test environment

- **Target:** `http://127.0.0.1:8789` — isolated UAT dashboard
- **Stack:** `docker-compose.uat.yml` — dashboard-only container, no scheduler, no telegram-agent (intentional, to isolate writes from prod and avoid Telegram 409)
- **Data:** snapshot of prod SQLite DB (`schoology_agent_db_uat` volume) + bind-mounted `./data-uat`
- **Prod stack:** `127.0.0.1:8787` — left untouched, 12 days uptime maintained
- **Method:** five `haiku` subagents in parallel, each exercising one surface (API, Home, Writes, Schoolwork, System Health)
- **Bring up:** `docker compose -p schoology-uat -f docker-compose.uat.yml up -d`
- **Tear down:** `docker compose -p schoology-uat -f docker-compose.uat.yml down` (volume `schoology_agent_db_uat` persists for re-runs; `docker volume rm` to remove)

The snapshot DB has **5 tonight / 10 waiting / 7 handled** assignments, which exercised most rendering paths. Writes were exercised with real tool calls — every `POST /api/tools/run` actually mutated the snapshot DB.

---

## Top 5 blockers — fix these first

1. **🔴 Bulk apply has no confirmation, no preview** — one click on `Apply` writes status changes to all selected items. ([beta_dashboard.js:1865-1881](../src/dashboard_assets/beta_dashboard.js#L1865-L1881))
2. **🔴 Past-date reminders silently accepted** — server stores reminders for year 2000 without warning; they never fire. ([db.js normalizeRemindAt](../src/db.js))
3. **🔴 Bulk apply is not atomic with audit notes** — single-row "Submitted" writes status + note; bulk writes only status. No audit trail on bulk operations. ([beta_dashboard.js:1872-1874](../src/dashboard_assets/beta_dashboard.js#L1872-L1874) vs [beta_dashboard.js:1806-1836](../src/dashboard_assets/beta_dashboard.js#L1806-L1836))
4. **🔴 `bucketLabel` vs `homeBucketLabel` data mismatch** — `/api/assignments` returns both fields for the same row; for `actionable` rows they read "Needs attention" vs "Needs Attention Tonight". Front-end picks one per view but the divergence is a code-smell that will eventually leak.
5. **🔴 Mobile nav is broken** — sidebar `display:none` at ≤860px with no replacement. Cannot switch views on phone. ([dashboard.css:1617](../src/dashboard_assets/dashboard.css#L1617))

---

## Findings by severity

### 🔴 Blockers (block JTBD or risk data integrity)

**B1. Bulk apply has no confirmation or preview.**
*Repro:* Open `/`, navigate to All Schoolwork, toggle Bulk select, check 3+ rows, pick a status, click Apply.
*Behavior:* Immediately calls `POST /api/tools/run` with `bulk_update_assignment_statuses`. 3 rows changed in 59ms. No modal, no preview, no undo.
*Verified response:* `{"ok":true,"successCount":3,"total":3,"results":[...]}` — server returns per-key results, but the UI never shows them.
*File:* [beta_dashboard.js:1865-1881](../src/dashboard_assets/beta_dashboard.js#L1865-L1881)
*Fix:* Modal confirm with item count + status preview before the POST. The server response shape (`results[]` with per-key outcomes) already supports a results-summary toast.

**B2. Past-date reminders silently accepted by the API.**
*Repro:* `curl -X POST http://127.0.0.1:8789/api/tools/run -H "x-schoology-dashboard-request: 1" -d '{"tool":"schedule_reminder","args":{"key":"assignment:8273633810","remindAt":"2000-01-01T08:00"}}'`
*Behavior:* HTTP 200, `{"ok":true,"reminderId":N,...}`. Reminder stored, never fires.
*File:* [db.js `normalizeRemindAt`](../src/db.js) only checks parseability, not future-ness.
*Fix:* `if (date < now - 60s) return { ok: false, error: "That time is already in the past." }`. Two-line fix. The edge-case-rendering audit identified the same gap.

**B3. Bulk apply is non-atomic with notes.**
*Repro:* Run `bulk_update_assignment_statuses` with status="E" for 3 keys.
*Behavior:* All 3 rows get `manualStatus="Waiting on teacher"` but no audit note added. Compare with the single-row `markAssignmentSubmitted` path which adds a "Marked submitted from dashboard." note + status in two sequential tool calls.
*File:* [beta_dashboard.js:1872-1874](../src/dashboard_assets/beta_dashboard.js#L1872-L1874) (bulk path), [beta_dashboard.js:1806-1836](../src/dashboard_assets/beta_dashboard.js#L1806-L1836) (single-row "Submitted" composite).
*Fix:* Extend `bulk_update_assignment_statuses` server-side to accept `noteText`; wrap status update + note insert in a single transaction.

**B4. `bucketLabel` and `homeBucketLabel` disagree for the same row.**
*Repro:* `curl -sS http://127.0.0.1:8789/api/assignments | jq '.rows[] | select(.displayCategory=="actionable") | {bucketLabel, homeBucketLabel}'`
*Behavior:* Two rows showed `bucketLabel="Needs attention"` and `homeBucketLabel="Needs Attention Tonight"` simultaneously.
*Why it matters:* Front-end picks one per view, so today no user-visible bug, but the duplicate fields are a setup for a contract drift later. Compounds with the §1.4 IA recommendation to unify object vocabulary.
*Fix:* Server-side: compute one canonical bucket label, pass a `tonightSuffix: true` flag to the home view if needed.

**B5. Mobile nav: sidebar `display:none` at ≤860px with no replacement.**
*Repro:* Resize browser to 800px wide on `http://127.0.0.1:8789`. Click anywhere but home.
*Behavior:* No nav. Can't switch views. Browser-back is the only way out.
*File:* [dashboard.css:1614-1625](../src/dashboard_assets/dashboard.css#L1614-L1625)
*Fix:* Build the bottom tab bar (Mock 5 in [docs/design/mocks/2026-05-25-dashboard-improvements.html](design/mocks/2026-05-25-dashboard-improvements.html)). Phase 1 work that hasn't shipped.

---

### 🟡 Major (meaningful friction, fix soon)

**M1. `refresh_schoology` blocks the request handler for 53 seconds in UAT.**
*Repro:* `curl -X POST http://127.0.0.1:8789/api/tools/run -H "x-schoology-dashboard-request: 1" -d '{"tool":"refresh_schoology","args":{}}'` — returned in 53.4s with `{"ok":false,"error":"Login failed..."}`.
*Why:* Blocks one HTTP worker for nearly a minute. On a Pi-class box with concurrent dashboard requests, this could exhaust the worker pool. In prod this would mean a real Schoology scrape running serially with no UI feedback past the optimistic flash.
*Fix:* Return 202 Accepted with a job id; poll job status from the client. Or return immediately with `{"ok":true,"queued":true}` and let the scheduler do the work.

**M2. Invalid status codes accepted without validation.**
*Repro:* `update_assignment_status` with `status:"Z"` (not in the documented `A-F` enum) returns `{"ok":true,"status":""}`.
*File:* [db.js normalizeManualStatus](../src/db.js)
*Fix:* Validate against `manualStatusOptions` from `/api/meta` before writing.

**M3. Omitting `status` silently clears the manual status.**
*Repro:* `update_assignment_status` with `{"args":{"key":"..."}}` (no `status` field) returns `{"ok":true,"status":""}` and clears the existing manual status.
*Why it hurts:* A buggy front-end form submission with a missing field wipes user-entered status. Defensive coding gap.
*Fix:* Make `status` required at the API boundary; return 400 if missing.

**M4. Search has no debounce — synchronous re-render on every keystroke.**
*Repro:* Type a 10-char query into the All Schoolwork search input. Every keystroke triggers `renderSchoolworkPane()`.
*File:* [beta_dashboard.js:2179-2182](../src/dashboard_assets/beta_dashboard.js#L2179-L2182)
*Why it hurts:* Visible jank with 22 assignments. Gets worse linearly with item count.
*Fix:* Wrap in a 200-300ms debounce.

**M5. Bulk-select state persists across view switches.**
*Repro:* Toggle Bulk select on Schoolwork, check 3 rows, navigate to Tonight, navigate back. Selection retained.
*File:* [beta_dashboard.js:51-53](../src/dashboard_assets/beta_dashboard.js#L51-L53), no clear on `switch-view`.
*Fix:* Clear `state.bulkMode` and `state.selectedAssignmentKeys` when `switch-view` fires and target ≠ "schoolwork".

**M6. The ⌘K search chip is decorative — no input, no handler. (Confirmed prediction.)**
*File:* [beta_index.html:65-69](../src/dashboard_assets/beta_index.html#L65-L69), [beta_dashboard.js:2205-2221](../src/dashboard_assets/beta_dashboard.js#L2205-L2221) — keydown handler only handles Enter/Space/Escape.
*Fix:* Mock #1 in the design doc — wire the search or remove the chip.

**M7. Drawer Save button label is generic "Save" — confirmed.**
*File:* [beta_dashboard.js:1407](../src/dashboard_assets/beta_dashboard.js#L1407)
*Fix:* `Save status` — one-line edit. Mock #8 in design doc.

**M8. Empty state copy is ambiguous: "All caught up — nothing needs attention tonight." regardless of whether scraper actually ran.**
*File:* [beta_dashboard.js:979,1049](../src/dashboard_assets/beta_dashboard.js#L979)
*Fix:* Append last-checked timestamp + degrade if stale. Mock #6 in design doc.

**M9. Schedule panel exposes raw cron strings to the parent.**
*Repro:* On System Health view, the Schedule list shows literal `0 6 * * *`, `0 7 * * *`, `*/1 * * * *`.
*File:* [beta_dashboard.js:853-855](../src/dashboard_assets/beta_dashboard.js#L853-L855)
*Fix:* Render human ("Weekdays at 6:00 AM") server-side via cron-parser or similar.

**M10. Status dot can show green while scrape is severely stale.**
*Repro:* In UAT today, scheduler/agent heartbeats are stale → dot is amber correctly. But the dot logic only considers heartbeat freshness, not `scrapeStale`. A live scheduler with a dead scraper → green dot + "Sync may be stale" banner. Trust signal incoherence.
*File:* [beta_dashboard.js:430-439](../src/dashboard_assets/beta_dashboard.js#L430-L439)
*Fix:* Include `activity.scrapeStale` in the status-dot calculation. If true → amber regardless of heartbeats.

**M11. Last-sync indicator is absent from Tonight; only on System Health.**
*Behavior:* The `sync-bar` ("Heartbeat live · Last scrape: X ago") only renders on the admin view. (Confirmed prediction.)
*Fix:* Mock #1 — promote sync info into the topbar pill across all views.

**M12. No `x-schoology-dashboard-request` header documented anywhere.**
*Repro:* `docs/DASHBOARD.md` security note says "JSON plus a same-origin custom header check" but doesn't name the header.
*Actual header:* `x-schoology-dashboard-request: 1` per [dashboard_server.js:69](../src/dashboard_server.js#L69)
*Fix:* Document in DASHBOARD.md security section.

**M13. Stored note content not HTML-escaped at the DB layer (defense-in-depth).**
*Repro:* Add a note with `<script>alert(1)</script>`. The stored value AND the `/api/assignments/:key/detail` response both contain the raw string.
*Status:* **Not actively exploited** because the renderer uses `esc()` at [beta_dashboard.js:79-85](../src/dashboard_assets/beta_dashboard.js#L79-L85) on every render path I inspected. Verified by reading the drawer's notes render code at line 1442.
*Why still major:* Any future consumer of the API that forgets to escape (e.g. a markdown plugin, a Telegram-side render, a third-party integration) gets a vulnerability for free. Storing escaped content would close the door rather than rely on every caller doing the right thing.
*Fix:* Either sanitize on write (lose original formatting but safest) or document that the API returns raw user-supplied strings and every consumer must escape.

---

### 🟢 Minor (polish)

**m1.** Invalid assignment key returns 404 with the same message as a valid-format-but-nonexistent key. Both return `{"ok":false,"error":"Assignment not found."}`. The malformed-key case should be 400, not 404. ([dashboard_server.js:145](../src/dashboard_server.js#L145))

**m2.** `POST /api/tools/run` with empty body returns `{"ok":false,"error":"Unsupported dashboard tool.","tool":""}` — echoing the empty tool back is confusing. Should say "Tool name is required."

**m3.** Missing required tool args returns HTTP 200 with nested `{"ok":false,"error":"..."}`. Mixing HTTP 200 with a nested error makes client error handling annoying. Recommend returning 400 when the inner ok is false on a write tool.

**m4.** SQL-style strings in notes (e.g. `'; DROP TABLE assignments; --`) are stored verbatim. Not exploitable (prepared statements), but no validation messaging.

**m5.** Tool response includes `assumptions` and `warnings` fields (intended for AI chat context) that the dashboard never reads. Dead bytes in every response.

**m6.** `lastError` from scheduler/agent heartbeats exists in `/api/health` but is not surfaced anywhere in the dashboard activity feed.

**m7.** Heartbeat `details` objects expose `pid`, `service`, `startedAt`, `timezone` — verified the UI filters these out and only shows `label / lastSeenLabel / state`. ✓ No leak today.

**m8.** Idempotency: most tools are correctly idempotent at the data level. `add_assignment_note` is by design not idempotent (creates a row each call). `delete_*` correctly returns "not found" on second call rather than echoing success.

---

## Predictions confirmed vs falsified

### Red-team predictions confirmed by UAT
- ✅ ⌘K is decorative (no handler, no input).
- ✅ Drawer Save button just says "Save".
- ✅ Empty state can't distinguish "all done" from "system broken".
- ✅ Mobile sidebar disappears with no replacement.
- ✅ Last-sync indicator only on System Health view.
- ✅ Bulk apply has no confirmation.
- ✅ Past-date reminders silently accepted.
- ✅ Schedule panel exposes raw cron strings.
- ✅ Bulk select state persists across view switches.
- ✅ Course-color stripe is not implemented (no `--course-` tokens in CSS).
- ✅ Coming Up / Waiting on Teacher default to collapsed (the state machine works correctly).

### Red-team predictions falsified by UAT
- ❌ **"Three count totals can disagree"** — actually they all match. `summary.tonightCount`, `sections.tonight.rows.length`, and the categorized row counts all agree at 5 tonight / 10 waiting / 7 handled / 22 total.
- ❌ **"Engineer copy in reasonText"** — the reasonText strings sampled were all parent-friendly: "The due date has already passed", "Schoology shows this as submitted and still awaiting a grade", "You marked this as waiting on a teacher". The earlier red-team finding D3 over-stated this; downgrade to 🟢 minor.
- ❌ **"XSS via assignment notes"** — stored unescaped but the renderer uses `esc()` everywhere I checked. Downgraded to defense-in-depth concern.

### Bugs UAT found that were NOT predicted
- 🔴 `bucketLabel` vs `homeBucketLabel` data divergence.
- 🟡 `refresh_schoology` blocks for 53 seconds with no async path.
- 🟡 Invalid status codes accepted (no enum validation).
- 🟡 Omitting `status` silently clears the field.
- 🟡 Search has no debounce.
- 🟢 404 vs 400 not distinguished for malformed keys.
- 🟢 Empty tool name returns "Unsupported" instead of "Required".
- 🟢 Header name not documented in DASHBOARD.md.

---

## Updated priority for Phase 0 quick wins

Given UAT confirmed most red-team predictions and surfaced a few new ones, the recommended Phase 0 order is now:

1. **Past-date reminder validation** (2-line server-side fix, prevents silent no-show).
2. **Bulk apply confirmation modal + atomic note option** (single biggest write-flow risk).
3. **Empty state with last-checked timestamp** (already mocked in Mock 6).
4. **Remove the fake ⌘K chip** (one-line markup deletion until search is wired).
5. **Make `status` required + validate enum on `update_assignment_status`** (defensive write API).
6. **Drawer Save → `Save status`** (one-line label change).
7. **Topbar sync pill** (Mock 1) and **course-color stripe** (Mock 2) — bigger but high-ROI.
8. **Status dot includes `scrapeStale`** so it doesn't lie when the scraper is down but processes are up.
9. **Search debounce** (one-helper-function fix).
10. **Document the `x-schoology-dashboard-request` header** in DASHBOARD.md.

These are all changes ≤30 LOC each except Mocks 1/2/5 which are bigger but already designed.

---

## UAT stack reuse

Leaving the UAT stack running on 8789 for follow-up testing. To restart fresh from a new prod snapshot:

```bash
# Stop UAT
docker compose -p schoology-uat -f docker-compose.uat.yml down
# Re-seed DB from current prod
docker volume rm schoology_agent_db_uat
docker volume create schoology_agent_db_uat
docker run --rm -v schoology_agent_db_prod:/src:ro -v schoology_agent_db_uat:/dst alpine \
  sh -c "cp /src/agent.db* /dst/"
# Re-seed bind-mount data
rm -rf data-uat && cp -r data data-uat
# Bring up
docker compose -p schoology-uat -f docker-compose.uat.yml up -d
```

To remove entirely: `docker compose -p schoology-uat down && docker volume rm schoology_agent_db_uat && rm -rf data-uat`.
