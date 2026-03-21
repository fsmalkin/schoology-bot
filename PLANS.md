# Codex Execution Plans (ExecPlans)

This file defines how we create and maintain execution plans for larger work.

## Purpose
- Make complex work predictable and reviewable.
- Keep scope, risks, and validation explicit.
- Provide a living plan that is updated as we learn.

## When to use an ExecPlan
Create an ExecPlan when work is:
- Multi-step or multi-hour
- A refactor or redesign
- Multi-milestone with dependencies
- Risky (could break prod, data, or UX)

## Where to write the ExecPlan
- Use this file as the single ExecPlan document.
- Keep it current while you work (it is a living plan).

## Required content
An ExecPlan must include:
- Goal
- Scope and non-goals
- Constraints and assumptions
- Risks and mitigations
- Step-by-step plan with milestones
- Validation plan (tests + checks)
- Rollback plan
- Open questions (if any)

## ExecPlan template (use this structure)

Title:
<short plan title>

Last updated:
YYYY-MM-DD

Goal:
- What outcome we want, in one or two sentences.

Scope:
In scope:
- ...
Out of scope:
- ...

Constraints and assumptions:
- ...

Risks and mitigations:
Risk:
- Description:
- Impact:
- Mitigation:

Plan:
Phase 1 - <name>
Tasks:
- ...
Dependencies:
- ...
End state:
- ...

Phase 2 - <name>
Tasks:
- ...
Dependencies:
- ...
End state:
- ...

Validation plan:
Unit tests:
- ...
Integration tests:
- ...
Smoke tests:
- ...
Manual checks (if any):
- ...

Rollback plan:
- How to revert quickly if needed.

Open questions:
- ...

Notes:
- Decision log or important context.

## Plan change rules
- If the plan changes, update this file immediately.
- Keep a short change log in Notes with date and reason.

## Format rules
- ASCII only.
- Plain Markdown.
- No code blocks unless explicitly required.

---

Title:
Card-First Parent Dashboard Redesign

Last updated:
2026-03-20

Goal:
- Keep the parent-first dashboard structure, but simplify the interaction model so cards are for scanning/opening and the right-side review drawer is the single place where assignment and follow-up edits happen.

Scope:
In scope:
- Keep the existing dashboard service and URL.
- Add parent-first `Home`, `All Schoolwork`, and tucked-away `Admin` experiences.
- Add `GET /api/home` plus updated metadata for the new navigation/copy model.
- Keep assignment/follow-up reads, detail drawer, and deterministic write APIs.
- Replace button-heavy card rails with click-to-open cards and a slide-out review drawer.
- Rebuild `All Schoolwork` as a card board with opt-in bulk selection instead of a table-driven quick-action surface.
- Add a dashboard-scoped write API for assignment/task actions using deterministic tool execution.
- Refactor the dashboard into static HTML/CSS/JS assets served by the existing Node server.
- Update docs and test coverage for the new dashboard surface.
Out of scope:
- Web chat UI inside the dashboard.
- Bug/feature filing UI.
- A new auth layer for the dashboard.
- New frontend build tooling or SPA framework adoption.

Constraints and assumptions:
- Runtime timezone defaults to `America/New_York`.
- Dashboard remains local-first and keeps the current trust model.
- Write routes must add same-origin plus custom-header JSON checks.
- Notes remain append-only in UI.
- Assignment reminders continue to replace the active pending reminder by default.
- Scope stays one child for now; no multi-child household model is added.
- Existing deterministic tool behavior remains the source of truth for dashboard writes.
- Assignment card faces should not contain ambiguous mutating buttons.

Risks and mitigations:
Risk:
- Dashboard UI diverges from chat behavior for writes.
Impact:
- Users see inconsistent assignment/task behavior across surfaces.
Mitigation:
- Route dashboard writes through `runToolByName` instead of duplicating business logic.

Risk:
- Parent-friendly copy and home bucketing drift away from real DB/tool state.
Impact:
- Parents see inconsistent labels or unexpected section placement.
Mitigation:
- Keep storage/tool semantics unchanged and add tests for home section classification and label mapping.

Risk:
- New dashboard write surface becomes too permissive.
Impact:
- Cross-site or non-dashboard POSTs can mutate local data.
Mitigation:
- Enforce a dashboard-specific tool allowlist and same-origin/custom-header request checks.

Plan:
Phase 1 - Parent read models
Tasks:
- Add parent-home data shaping for `Needs Attention Tonight`, `Coming Up`, `Waiting on School`, and `Handled for Now`.
- Re-map assignment display labels to parent-facing wording without changing stored status values.
- Keep `All Schoolwork` reads separate from `Admin` health snapshot shaping.
Dependencies:
- Existing DB/read models, status handling, and reminder/task tool behavior.
End state:
- Backend can serve a parent-home payload plus schoolwork/admin data without going through chat planning.

Phase 2 - Server and UI delivery
Tasks:
- Add `GET /api/home`.
- Replace the Workbench shell with `Home / All Schoolwork / Admin`.
- Make `Home` and `All Schoolwork` card-first surfaces where clicking a card opens the drawer.
- Convert the drawer into a fixed right-side slide-out with backdrop, keyboard close, and focus return.
- Move assignment status changes, note saves, reminder saves, and follow-up edits into the drawer with explicit submit buttons.
- Rebuild `All Schoolwork` as grouped card lanes plus opt-in bulk selection.
- Add `POST /api/tools/run` with dashboard-scoped allowlist and request hardening.
Dependencies:
- Phase 1 complete.
End state:
- Dashboard serves a parent-first planning UI with explicit card-open behavior, calmer card surfaces, and a single editing drawer while preserving full assignment management and Admin health visibility.

Phase 3 - Validation and docs
Tasks:
- Add unit/data tests for home section classification, parent-facing labels, and reminder/task filtering.
- Add server integration tests for assets, `GET /api/home`, read APIs, write guardrails, and mutations.
- Update README, dashboard docs, system docs, and test coverage docs.
Dependencies:
- Phase 1 and Phase 2 complete.
End state:
- Feature is documented and regression coverage exists for both parent-home shaping and HTTP behavior.

Phase 4 - Beta stabilization and release confidence
Tasks:
- Add shared dashboard test fixtures so stable and beta server/browser tests can reuse the same seeded runtime setup.
- Extend HTTP integration coverage to validate `/beta` plus `/beta/assets/beta.css` and `/beta/assets/beta.js`.
- Add a dedicated beta browser smoke suite for page boot, view switching, drawer open/close, accordion sections, explicit assignment writes, reminder/task flows, and mobile drawer behavior.
- Fix beta-only regressions in `beta_dashboard.js` in this order: rerender/polling draft loss, stale async drawer responses, focus return and keyboard behavior, and composite `Submitted` partial-failure handling.
- Add at least one beta race/regression scenario for stale detail responses or close-before-response behavior.
Dependencies:
- Phase 2 complete.
End state:
- `/beta` has its own core-flow safety net and the highest-risk client-state bugs are covered by automated tests before promotion decisions.

Validation plan:
Unit tests:
- Parent-home and schoolwork data shaping tests.
- Reminder/time label tests shared with existing task/reminder behavior.
Integration tests:
- Dashboard HTTP tests for assets, `GET /api/home`, read APIs, write guardrails, and assignment/task mutations.
- Dashboard browser smoke test for click-to-open cards, drawer close behavior, explicit status save, and bulk-mode reveal.
- Dedicated `/beta` HTTP coverage for the beta shell and beta-only assets.
- Dedicated `/beta` browser smoke for beta-only interactions and core regression cases.
- Dedicated `/beta` browser smoke should cover stale detail-response races and timer-driven health-poll rerenders in addition to core interaction flows.
- Full `npm test` run.
Smoke tests:
- `docker compose up -d --build`
Manual checks (if any):
- Open `http://127.0.0.1:8787` and verify:
  - `Home` loads by default.
  - Clicking a card clearly opens the right-side review drawer.
  - No default assignment card button appears to mutate data directly.
  - `All Schoolwork` search/filter/bulk status flows work in card mode.
  - `Admin` still shows health/commands/docs.
  - `/beta` loads on desktop and a mobile-width viewport without console errors.
  - Closing the beta drawer returns focus to the opener and does not lose in-progress edits during normal interaction.
  - Reminder and follow-up edits still behave correctly on `/beta`.
  - If reminder/task write behavior changed, run `npm run beta:reset-memory`, `npm run stories:run`, and `npm run stories:judge` before human UAT.

Rollback plan:
- Revert to last stable commit/image and rebuild containers.
- Rebuild the dashboard service from the last known-good commit.
- Validate `/api/health` and the dashboard page load before resuming work.

Open questions:
- None.

Notes:
- 2026-03-05: Decision - keep the dashboard in plain static assets served by the current Node server; no new frontend toolchain.
- 2026-03-05: Decision - dashboard writes must reuse deterministic tool execution and remain limited to assignment/task actions.
- 2026-03-06: Decision - replace the Workbench UI with a parent-first `Home / All Schoolwork / Admin` experience rather than iterating the operator mental model.
- 2026-03-06: Decision - `Submitted` is a dashboard-local composite action (note + waiting-on-teacher status) built on existing deterministic tool calls.
- 2026-03-07: Decision - remove on-card assignment quick actions and make the review drawer the single editing surface so parents do not have to guess which buttons write immediately.
- 2026-03-08: Decision - collapse secondary home sections, convert `All Schoolwork` from a board to one grouped list, and keep only one editable drawer section open at a time to reduce visual noise.
- 2026-03-20: Decision - keep `/beta` on the existing dashboard API contract and add a dedicated beta test layer rather than splitting backend behavior.
- 2026-03-20: Decision - prioritize beta stabilization around client-state safety: stale request guards, draft preservation, and focus return before broader polish.
