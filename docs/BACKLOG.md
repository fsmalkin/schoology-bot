# Backlog

This file tracks active and proposed work items with GitHub issue linkage.

## P1 (Current)
1. [#25 Claude Managed Agents migration](https://github.com/fsmalkin/schoology-bot/issues/25)
   - Status: In progress
   - Project board: [FSM Engineering Board](https://github.com/users/fsmalkin/projects/3)
   - Planning doc: [docs/managed-agents/README.md](managed-agents/README.md)
   - Outcome target: Replace the abandoned agent-runtime experiment with a Claude Managed Agents dev runtime, remove retired runtime artifacts, then promote to prod after parity, observability, cost, and rollback gates pass.
   - Acceptance gate:
      - Managed Agents session bridge supports Telegram message intake and response delivery in dev.
      - Claude custom tool requests execute existing deterministic Schoology tools without bypassing current DB/status/reminder rules.
      - Dev parity covers refresh, list missing, update status, notes, reminders, daily summary, Telegram formatting, failure handling, and duplicate-response prevention.
      - Runtime has session mapping, idle/termination policy, event logging, health signal, and explicit rollback to the current committed prod Docker runtime.
      - Retired runtime code, compose, scripts, tests, and active docs are removed before prod canary unless a concrete current-runtime dependency is proven.
      - Production cutover includes canary prompts, cost/idle monitoring, and 24h stabilization.
   - Slices:
      - [#27 Session mapping and dev config](https://github.com/fsmalkin/schoology-bot/issues/27) - done
      - [#28 Telegram dev bridge](https://github.com/fsmalkin/schoology-bot/issues/28) - dev foundation implemented
      - [#29 Custom tool loop](https://github.com/fsmalkin/schoology-bot/issues/29) - hardening started
      - [#30 Parity story suite and judge gate](https://github.com/fsmalkin/schoology-bot/issues/30) - final beta Telegram container proof remains
      - [#31 Health, event log, and idle cost controls](https://github.com/fsmalkin/schoology-bot/issues/31)
      - [#32 Prod canary, rollback, and stabilization](https://github.com/fsmalkin/schoology-bot/issues/32)
      - [#34 Retired runtime code/repo removal](https://github.com/fsmalkin/schoology-bot/issues/34)
2. [#34 Remove retired runtime code and repo artifacts](https://github.com/fsmalkin/schoology-bot/issues/34)
   - Status: Open
   - Outcome target: Delete retired runtime code, compose files, bootstrap/reset paths, tests, and active docs now that current prod Docker is the rollback target.
   - Acceptance gate:
      - No package scripts, active compose files, startup scripts, dashboard branches, or tests present the retired runtime as a runnable path.
      - Managed Agents/prod Docker docs and commands replace legacy beta instructions.
      - Historical notes are either deleted or clearly archived with no operational instructions.
      - Docker rebuild, managed-dev poller, dashboard health, and relevant agent smokes pass after removal.
3. Managed Agents release gate modernization
   - Status: Not yet filed
   - Outcome target: Replace legacy beta reset/release gate assumptions with Managed Agents dev artifacts and judge evidence.
4. Login/session resilience follow-up
   - Status: Open (#18 parked unless strategy changes)
   - Outcome target: Keep Schoology login/session recovery reliable across the Managed Agents cutover.

## P2 (Planned)
1. Dashboard Phase 1 - foundation polish
   - Status: Deferred behind Managed Agents
   - Design reference: `docs/DASHBOARD_DESIGN.md` Phase 1
   - Items:
      - Confirm sidebar nav selections work after Docker rebuild (2026-03-15).
      - Course color stripes on assignment rows (left border, hashed from course name).
      - Mobile bottom tab bar (replaces hidden sidebar on narrow screens).
      - System status dot in Tonight right column (green/amber/red, links to system panel).
2. Dashboard Phase 2 - This Week view
   - Status: Not yet filed
   - Design reference: `docs/DASHBOARD_DESIGN.md` Phase 2
   - Outcome target: 7-day calendar strip + day-lane assignment grouping. Prev/next week navigation. Uses existing `dueDateYmd` from `/api/home`.
3. Dashboard Phase 3 - System panel demotion
   - Status: Not yet filed
   - Design reference: `docs/DASHBOARD_DESIGN.md` Phase 3
   - Outcome target: System Health becomes a slide-in panel (like the drawer) rather than a full nav view. Triggered by status dot click or sidebar "System" item.
4. Dashboard Phase 4 - Command palette
   - Status: Not yet filed
   - Design reference: `docs/DASHBOARD_DESIGN.md` Phase 4
   - Outcome target: Floating command launcher with fuzzy assignment search and shortcut commands (refresh, add task, go to week).
5. Scheduled auto-update task decision
   - Status: Not yet filed
   - Outcome target: Decide manual-only vs scheduled update path.
6. Claude Agent SDK fallback evaluation
   - Status: Not yet filed
   - Outcome target: Evaluate only if Managed Agents blocks or self-hosted execution becomes a better fit.
7. Cross-project rollout of the agentic release pattern
   - Status: Not yet filed
   - Outcome target: Reuse beta reset + story gate + judge evidence flow in other repos as a standard release template.

## Archived or Superseded
1. Agent shell/runtime decision gate
   - Status: Completed/superseded by Claude Managed Agents migration (2026-05-25).
   - Note: The May 17 decision gate compared Claude App, GPT app, and managed agent paths. The selected path is Claude Managed Agents while preserving deterministic Schoology tool execution and local/server state ownership.
2. Retired runtime beta UAT and production promotion readiness
   - Status: Superseded by Claude Managed Agents migration and removal issue #34.
   - Note: The retired runtime is no longer rollback/reference context; delete active artifacts unless a current-runtime dependency is proven.
3. Retired runtime upstream sync SOP
   - Status: Dropped unless explicitly requested.
4. Retired runtime cron bootstrap hardening
   - Status: Dropped unless explicitly requested.

## Recently Groomed Issues
1. Recurring reminder support: release gate completed in the March 2026 correctness wave.
2. #8 Renamed for clarity: reminder shorthand parsing/confirmation flow.
3. #9 Renamed for clarity: empty/low-context bug filing issue.
4. #11 Closed: beta skill smoke check for empty issue handling.
5. #12 Closed: weekend daily schedule update enhancement.
6. #13 Completed in code: capability registry + planner/agent guardrails.
7. Dashboard redesign (2026-03-15): sidebar nav, metric row, 2-column home layout shipped to prod.
8. Schoology title derivation (2026-03-15): clean display names for no-link Schoology rows shipped to prod.
9. Agent shell/runtime choice elevated to P1 (2026-05-17): decision gate completed with Claude Managed Agents selected.

## Planning Governance
- Canonical backlog lives on `main`.
- Managed Agents migration notes live under `docs/managed-agents/`; retired beta experiments must not be used as active planning.
- Intake first: duplicate-check evidence is required before creating/adding work items.
- Active execution state lives on the GitHub Project `FSM Engineering Board`; this backlog stays strategic.
- Cross-thread handoff also updates `docs/WORKLOG.md`.

## Recently Completed
1. Local server migration off laptop runtime
   - Status: Completed (2026-02-18)
   - Outcome: Production runtime now runs on local server Docker with persistent data and health checks.
