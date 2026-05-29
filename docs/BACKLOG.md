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
5. Secrets hygiene (P0 from audit §1)
   - Status: Not yet filed
   - Outcome target: Remove cleartext-credential exposure. Secrets in `.env.systemd`/`.env.beta.systemd` are gitignored and not in history, but sit on disk in cleartext (Schoology password, OpenAI key, Telegram token, GitHub PAT).
   - Acceptance gate:
      - All four credentials rotated.
      - Secrets read from Docker secrets / keychain rather than on-disk `.env.*`.
      - `gitleaks` or `git-secrets` pre-commit hook in place.
      - `CHOLOGY_USERNAME` typo in `.env.systemd:1` fixed.
      - `.env.managed-dev` / `.env.managed-prod` checked for the same exposure before prod cutover.
   - Note: Small and independent of the Managed Agents ordering; high blast radius, low effort.

## P2 (Planned)
Dashboard work is driven by `docs/DASHBOARD_AUDIT.md` (UAT-verified findings + tiers), which supersedes the `DASHBOARD_DESIGN.md` phase numbering. Verified-only mocks: `docs/design/mocks/dashboard-improvements-v1.html`. All deferred behind the Managed Agents migration.

1. Dashboard Tier 1 - data integrity + trust
   - Status: Deferred behind Managed Agents
   - Reference: `docs/DASHBOARD_AUDIT.md` §0 punch list, §4.1-4.4, §7
   - Items (each ≤30 LOC except where noted):
      - Suspicious-scrape guard: refuse to mass-resolve when a scrape returns <50% of prior count; degrade status dot to amber (§0.1 / §7 E5). Highest-impact fix.
      - Past-date reminder validation + echo-back confirmation (§0.3 / §4.4 DR1).
      - Bulk apply confirmation modal + atomic note option (§0.4 / §4.3 SW1).
      - Topbar sync pill + wire the fake ⌘K search; status dot opens a panel (§0.5 / §4.1).
      - Empty/stale state distinguishes "all done" from "silently broken" (§4.2).
2. Dashboard Tier 2 - scan + mobile foundation
   - Status: Deferred behind Managed Agents
   - Reference: `docs/DASHBOARD_AUDIT.md` §4.2, §4.6, §4.8, §4.4
   - Items:
      - Mobile bottom tab bar (sidebar vanishes on narrow screens with no replacement, §4.6 MB1).
      - Course color stripe on rows + WCAG-AA contrast bump (label is 4.18:1, fails by 0.32; §4.2 TV3).
      - Sidebar density: short labels, Monitor footer with system status, brighter active state (§4.8 SB1-4).
      - Drawer header compression to 3 lines + per-assignment "synced" time + scoped save label (§4.4 DR3/5/7).
   - Note: Coming Up/Waiting already collapse by default (UAT-verified) — do not rebuild.
3. Dashboard This Week view
   - Status: Not yet filed
   - Reference: `docs/DASHBOARD_AUDIT.md` §3
   - Outcome target: Today right-rail 7-day mini-strip first; full route only if forward data exceeds 7 days. (Downgraded from a standalone view: the Sunday-planning JTBD scores 8/25.)
4. Dashboard System panel + command palette
   - Status: Not yet filed
   - Reference: `docs/DASHBOARD_AUDIT.md` §3 IA + §10 Phase 4
   - Outcome target: Demote System Health to a slide-in panel triggered by the topbar status dot. Command palette only after the basic ⌘K search ships in Tier 1.
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
10. Dashboard backlog reframed (2026-05-28): old Phase 1-5 numbering (`DASHBOARD_DESIGN.md`) replaced by UAT-verified tiers in `docs/DASHBOARD_AUDIT.md`; secrets-hygiene P0 surfaced and filed under P1.

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
