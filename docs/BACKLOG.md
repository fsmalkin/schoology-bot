# Backlog

This file tracks active and proposed work items with GitHub issue linkage.

## P1 (Current)
1. Agent shell/runtime decision gate
   - Status: In progress
   - Outcome target: Choose Claude App, GPT app, or managed agent as the next user-facing/runtime path while preserving the existing Schoology core functions.
   - Include implementation acceleration as a decision factor: evaluate whether the current ChatGPT/GitHub workflow can support a safe, auditable development feedback loop that speeds validation while preserving approvals and runtime boundaries.
   - Core functions to preserve:
     - Schoology refresh/scrape and login/session handling.
     - Assignment normalization and stable identity.
     - Manual statuses, notes, reminders/tasks, and pending confirmations.
     - Daily summaries and reminder delivery.
     - Dashboard health/status visibility.
     - Deterministic app-executed tool actions.
     - Local/server state ownership unless explicitly migrated.
   - Acceptance gate:
     - Short decision memo compares Claude App, GPT app, and managed agent.
     - Memo identifies selected path, rejected alternatives, migration steps, and rollback plan.
     - Memo includes an implementation-acceleration recommendation and explains whether it changes the selected path.
     - Parity checklist covers refresh, summary, reminders, status updates, notes, dashboard health, and failure alerts.
2. Implementation accelerator evaluation
   - Status: In progress
   - Outcome target: Decide whether to add a safe, auditable feedback loop between this planning/implementation chat and the development environment to accelerate validation.
   - Candidate paths:
     - GitHub-mediated request/result workflow.
     - Existing OpenClaw gateway path.
     - MCP-style bridge if an accessible host/client path is available.
     - Managed-agent alternative.
   - Guardrails:
     - Default-deny policy with explicit approved operations.
     - Human approval for production-impacting or credential/session-sensitive work.
     - Structured request/result records with audit history.
     - Redacted and bounded outputs.
     - No production Schoology action without explicit approval.
3. Recurring reminders release gate and rollout
   - Status: In progress
   - Outcome target: Complete beta reset, story suite, one-pass GPT-5.2 judge evidence, user UAT, and production rollout.
   - Acceptance gate:
     - `scripts/reset_beta_from_prod_memory.ps1` report artifact produced.
     - Agentic story suite artifacts produced.
     - One GPT-5.2 judge JSON artifact produced with required stories passing.
4. OpenClaw beta UAT and production promotion readiness
   - Status: In progress
   - Outcome target: Confirm parity for refresh/chat/reminders and complete a low-risk production cutover checklist.
5. Dashboard Phase 1 — foundation polish
   - Status: In progress
   - Design reference: `docs/DASHBOARD_DESIGN.md` Phase 1
   - Items:
     a. Confirm sidebar nav selections work after Docker rebuild (2026-03-15)
     b. Course color stripes on assignment rows (left border, hashed from course name)
     c. Mobile bottom tab bar (replaces hidden sidebar on ≤ 860px)
     d. System status dot in Tonight right column (green/amber/red, links to system panel)
6. #14 DB-backed context compaction and long-thread memory
   - Status: Open
   - Outcome target: Long chats retain critical context with bounded token use.
7. #15 Detail-page fallback for ambiguous submission status
   - Status: Open
   - Outcome target: Submission state classification remains accurate when list view is ambiguous.
   - Known ambiguity: title suffixes like `(Graded: <date>)` may describe assignment-level timing and are not reliable proof that the current student's work is graded/resolved.
8. #10 Auto-cancel reminders for inactive/resolved assignments
   - Status: Open
   - Outcome target: Assignment-linked reminders do not fire after item becomes inactive.

## P2 (Planned)
1. Dashboard Phase 2 — This Week view
   - Status: Not yet filed
   - Design reference: `docs/DASHBOARD_DESIGN.md` Phase 2
   - Outcome target: 7-day calendar strip + day-lane assignment grouping. Prev/next week navigation. Uses existing `dueDateYmd` from `/api/home`.
2. Dashboard Phase 3 — System panel demotion
   - Status: Not yet filed
   - Design reference: `docs/DASHBOARD_DESIGN.md` Phase 3
   - Outcome target: System Health becomes a slide-in panel (like the drawer) rather than a full nav view. Triggered by status dot click or sidebar "System" item.
3. Dashboard Phase 4 — Command palette (⌘K)
   - Status: Not yet filed
   - Design reference: `docs/DASHBOARD_DESIGN.md` Phase 4
   - Outcome target: ⌘K opens a floating command launcher with fuzzy assignment search and shortcut commands (refresh, add task, go to week).
4. OpenClaw upstream sync SOP
   - Status: Not yet filed
   - Outcome target: Repeatable update cadence with verification checklist.
5. Scheduled auto-update task decision
   - Status: Not yet filed
   - Outcome target: Decide manual-only vs scheduled update path.
6. Provider/SDK follow-through after agent shell/runtime decision
   - Status: Not yet filed
   - Outcome target: Implement selected provider/runtime path without weakening the deterministic Schoology tool boundary.
7. Cross-project rollout of the agentic release pattern
   - Status: Not yet filed
   - Outcome target: Reuse beta reset + story gate + judge evidence flow in other repos as a standard release template.

## Recently Groomed Issues
1. Recurring reminder support: moved from groomed scope to active release execution (2026-02-22).
2. #8 Renamed for clarity: reminder shorthand parsing/confirmation flow.
3. #9 Renamed for clarity: empty/low-context bug filing issue.
4. #11 Closed: beta skill smoke check for empty issue handling.
5. #12 Closed: weekend daily schedule update enhancement.
6. #13 Completed in code: capability registry + planner/agent guardrails.
7. Dashboard redesign (2026-03-15): sidebar nav, metric row, 2-column home layout shipped to prod. All 111 tests pass.
8. Schoology title derivation (2026-03-15): clean display names for no-link Schoology rows shipped to prod.
9. Agent shell/runtime choice elevated to P1 (2026-05-17): choose Claude App, GPT app, or managed agent before further wrapper/runtime promotion.
10. Implementation accelerator added to decision gate (2026-05-17): evaluate safe feedback-loop options before choosing runtime path.

## Planning Governance
- Canonical backlog lives on `main`.
- Branch-specific backlog items (e.g., OpenClaw beta experiments) should be kept in branch docs and merged only after validation.
- Intake first: duplicate-check evidence is required before creating/adding work items.
- Active execution state lives on the GitHub Project `FSM Engineering Board`; this backlog stays strategic.
- Cross-thread handoff also updates `docs/WORKLOG.md`.

## Recently Completed
1. Local server migration off laptop runtime
   - Status: Completed (2026-02-18)
   - Outcome: Production runtime now runs on local server Docker with persistent data and health checks.