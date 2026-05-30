# Roadmap

## Goal
Run a reliable Schoology assistant on the local server that refreshes assignments, keeps actionable status clean, and delivers clear daily/reminder updates via Telegram while preserving the deterministic Schoology workflow through the Claude Managed Agents migration.

## Current Decisions
- Login uses Mayari username and password directly.
- MFA is not expected.
- Headless browser only for unattended scrape/runtime work; interactive browser login is used to refresh storage when needed.
- Non-secret config lives in `.env`/generated runtime env; live production
  secrets are migrating to Windows Credential Manager and Docker secret files
  without required rotation unless a specific exposure is identified.
- Scrape runs at 6:00 AM ET, summary sent at 7:00 AM ET.
- Reminder scheduler runs every minute to deliver task reminders.
- Daily summary delivery via Telegram.
- Telegram agent runs as a single instance to avoid duplicate responses.
- Incoming Telegram messages are batched briefly and the oldest dropped if too long.
- Product boundary: preserve core functions regardless of agent shell/runtime choice: Schoology refresh/scrape, assignment normalization, manual statuses, notes, reminders/tasks, daily summaries, dashboard health, deterministic tool execution, local/server state, and Telegram delivery until intentionally replaced.
- Agent shell/runtime decision gate selected Claude Managed Agents as the dev-to-prod migration path.
- Legacy prod agent model choice remains GPT-5.2 until the Claude Managed Agents cutover.
- Tool execution is handled by app code; models may plan or request tools, but deterministic app code performs writes.
- Availability target: run via Docker with restart policy + health check; update with `docker compose -p schoology-prod up -d --build`.
- Production runtime is hosted on the local server (Docker Compose).
- If using Twilio later, use Auth Token for now; plan to switch to API Key for server move.
- Session-based login: use one-time interactive login and refresh when session expires.
- Add Telegram alert when re-authentication is required.
- Daily summary lists only unresolved items (Missing, Incomplete, Not completed/submitted, Absent).
- Maintain offline unit + E2E tests using fixtures (no live Schoology needed).
- Daily summary includes tasks scheduled for today.
- One-time tasks roll over by 24 hours if not completed.
- Recurring reminders are supported for `daily`, `weekdays`, and `weekly` cadence.
- Reminder writes are agent-mediated: infer missing cadence/time when safe, create, then confirm assumptions with quick correction prompts.
- Daily summary is DB-backed (manual statuses honored) and agentic for Telegram.
- Local health dashboard is available at `http://127.0.0.1:8787` for service/data checks.
- Bug filing auto-generates a title when missing.
- Pending actions are stored per chat to complete multi-step confirmations.
- Bug filing uses a draft+validate+submit skill (no empty issues).
- Schoology "submitted but not graded" indicators are auto-archived (Ignored) in summaries/lists by default.
- Schoology title text like `(Graded: <date>)` is treated as descriptive only; it does not, by itself, prove the current student's assignment is graded or resolved.
- The abandoned runtime experiment is rejected and removed from code, compose files, scripts, and active docs under [#34](https://github.com/fsmalkin/schoology-bot/issues/34). The rollback target is the current committed Docker prod runtime.
- Claude Managed Agents is the top-priority replacement runtime: implement in dev first, validate against parity gates, then promote to prod.
- Managed Agents dev bridge routes Telegram inbound through managed sessions when enabled; Claude custom tool requests execute through the existing deterministic tool runner in-process, and local scheduler/reminder delivery stays authoritative until parity and idle-cost controls are proven.
- Managed Agents dev/prod separation must keep distinct env, session mapping, data, health, and rollback boundaries.
- Existing legacy beta reset/runtime commands have been retired; do not use them for new UAT or rollback planning.
- Disaster-recovery automation uses scheduled backup + freshness checks with off-machine folder sync.
- Agentic release gate is mandatory before UAT for agent runtime changes:
  - Run Managed Agents dev against copied prod memory/state.
  - Run agentic story suite.
  - Run one judge pass and review evidence.
  - Confirm rollback command plus cost/idle monitoring.
  - Then execute user UAT.

## Status Snapshot (2026-05-28)
- Delivered:
  - Dashboard audit completed and consolidated into `docs/DASHBOARD_AUDIT.md` (supersedes the `DASHBOARD_DESIGN.md` phase framing as the dashboard source of truth). Findings are UAT-verified against an isolated prod-snapshot stack; severity recalibrated after ~30% of pre-test "critical" predictions were downgraded or falsified. Verified-only mocks live at `docs/design/mocks/dashboard-improvements-v1.html`.
  - Audit surfaced a P0 hygiene item (cleartext secrets on disk in `.env.systemd`/`.env.beta.systemd`) and a #1 data-integrity fix (suspicious-scrape guard) — both folded into the queues below.
  - Runtime migrated from laptop to local server and is running in Docker Compose with health checks.
  - The abandoned runtime experiment is no longer a rollback/reference target and has been removed under [#34](https://github.com/fsmalkin/schoology-bot/issues/34).
  - Agent shell/runtime decision gate completed: Claude Managed Agents is the selected replacement path while deterministic Schoology tool execution and local/server state ownership remain intact.
  - Recovery runbook and operations scripts added for start/backup/restore/freshness/task registration.
  - Login failure messaging now respects configured `SCHOLOGY_IDP` and avoids unnecessary provider-selection prompts.
  - Recurring reminder runtime support implemented across DB, tool runner, and reminder scheduler (`daily`, `weekdays`, `weekly`).
  - Dashboard redesigned with dark sidebar nav, 4-card metric row, and 2-column home layout (assignment sections + right-col panels). Replaces the hero/tab-bar shell. Section labels updated for clarity (`Tonight's Assignments`, `Waiting on Teacher`).
  - Schoology title derivation: assignments with no link title now derive a clean display name from the raw Schoology row text.
  - MUA/external-tool-link scrape correctness wave delivered: score-vs-missing conflict handling, detail-page fallback for ambiguous rows, stable assignment identity refresh, auto-cancel-on-resolve reminder cleanup, DB-backed chat memory/style persistence, plain-language formatting, richer follow-up replies, and `Will complete in class` status support.
  - Reminder-scope release gate completed for this wave: story suite, judge, prod rebuild, and dashboard health checks.
  - Full dashboard design plan written (`docs/DASHBOARD_DESIGN.md`): user stories, navigation architecture, view designs, interaction patterns, mobile layout, and implementation phases.
  - Managed Agents config/session mapping foundation delivered in [#27](https://github.com/fsmalkin/schoology-bot/issues/27).
  - Managed Agents Telegram dev bridge foundation delivered in [#28](https://github.com/fsmalkin/schoology-bot/issues/28): runtime router, Claude session event client, assistant text streaming, and mock custom Schoology tool result flow.
  - Managed Agents custom tool loop hardening started in [#29](https://github.com/fsmalkin/schoology-bot/issues/29): exported tool definitions, unsupported-tool errors, built-in tool denial, invalid-arg errors, bounded result payloads, loop guardrails, and duplicate action-id dedupe.
  - Managed Agents parity runner prep and live dev evidence delivered in [#30](https://github.com/fsmalkin/schoology-bot/issues/30): story suite routing through `runChatMessage`, live story judge artifacts, scoped JTBD UAT, beta Schoology auth refresh, and live `refresh_schoology` repro against real Schoology data.
  - Managed-prod cutover started in [#32](https://github.com/fsmalkin/schoology-bot/issues/32): current live secrets imported to Windows Credential Manager without provider-side rotation, Docker secret-file runtime enabled, prod Claude agent updated, prod memory store created, scheduler/Telegram/dashboard started with the managed-prod override, and prod smoke UAT passed.
- In progress:
  - Capture a human-sent prod Telegram inbound message against the managed-prod poller.
  - Monitor [#32](https://github.com/fsmalkin/schoology-bot/issues/32) for 24 hours for duplicate replies, missed reminders, failed tools, stale scrape/login, idle reset/cost anomalies, and unexpected writes.
  - Dashboard Phase 1 polish remains useful but is behind the Managed Agents migration.

## Agent Shell/Runtime Decision Gate (Completed)
The May 17 planning gate compared Claude App, GPT app, and managed agent paths. The selected path is Claude Managed Agents because it best preserves the current Telegram/dashboard workflow while reducing self-hosted agent-runtime burden.

Decision requirements that remain active:
- Preserve core functions listed in Current Decisions.
- Keep Schoology actions deterministic and app-executed; the model may plan, but code performs writes.
- Keep local/server data ownership unless an explicit migration decision is made.
- Require parity checks for refresh, summary, reminders, status updates, notes, dashboard health, and failure alerts.
- Maintain rollback to the existing Docker prod runtime until the managed path passes prod canary gates.

## Active Queue (P1)
1. [#25 Claude Managed Agents dev runtime and production cutover plan](https://github.com/fsmalkin/schoology-bot/issues/25) ([tracking doc](managed-agents/README.md)).
2. [#30 Managed Agents parity gate](https://github.com/fsmalkin/schoology-bot/issues/30): refresh, list missing, update status, notes, reminders, daily summary, Telegram UX, failure handling, and no duplicate responses.
3. [#34 Remove retired runtime code and repo artifacts](https://github.com/fsmalkin/schoology-bot/issues/34): delete retired source, compose, scripts, tests, and active docs; keep current prod Docker as rollback.
4. [#31 Managed Agents observability/cost controls](https://github.com/fsmalkin/schoology-bot/issues/31): session mapping, idle/termination policy, event logs, health dashboard signal, and rollback switch to current prod Docker.
5. [#32 Managed Agents prod canary, rollback, and stabilization](https://github.com/fsmalkin/schoology-bot/issues/32): canary started; 24h stabilization in progress.
6. Login/session resilience follow-up while keeping secrets-based unattended login (#18) parked unless strategy changes.
7. Secrets hygiene (audit §1, small/independent): import current live values
   into Windows Credential Manager, move runtime reads to Docker secret files,
   add tracked-file secret scanning, and fix the `CHOLOGY_USERNAME` typo in
   `.env.systemd`. Rotate individual credentials only if a concrete exposure is
   identified.

## Ready Next (P2)
Dashboard work is now driven by `docs/DASHBOARD_AUDIT.md` (verified findings + tiers), not the older `DASHBOARD_DESIGN.md` phase numbering. Mocks: `docs/design/mocks/dashboard-improvements-v1.html`. Still sequenced behind the Managed Agents migration.

1. Dashboard Tier 1 — data integrity + trust (audit §0 punch list):
   - Suspicious-scrape guard: refuse to mass-resolve when a scrape returns <50% of prior count; degrade status dot to amber (audit §0.1 / §7 E5). Highest-impact fix in the audit.
   - Past-date reminder validation + echo-back confirmation (audit §0.3 / §4.4 DR1).
   - Bulk apply confirmation modal + atomic note option (audit §0.4 / §4.3 SW1).
   - Topbar sync pill replaces breadcrumb + powers refresh-on-stale; wire the (currently fake) ⌘K search (audit §0.5 / §4.1).
   - Empty/stale state distinguishes "all done" from "silently broken" (audit §4.2; surfaces the scrape guard).
2. Dashboard Tier 2 — scan + mobile foundation: mobile bottom tab bar (sidebar currently vanishes with no replacement, audit §4.6 MB1), course color stripe + WCAG-AA contrast bump (§4.2 TV3), sidebar density (§4.8), drawer header compression (§4.4). Note: Coming Up/Waiting collapse already ships (UAT-verified); do not re-build it.
3. This Week view (calendar strip + day-lane). Deferred per audit §3 unless forward-looking data exceeds 7 days; the Today right-rail mini-strip is the cheaper first step.
4. System panel demotion + command palette (audit §3 IA + §10 Phase 4). Command palette only after the basic ⌘K search from Tier 1 exists.
5. Scheduled auto-update task decision (Windows Task Scheduler).
6. Claude Agent SDK fallback evaluation only if Managed Agents blocks or self-hosted execution becomes a better fit.
7. Extend the agentic release pattern to other projects and templates.

## Later (P3)
1. Dashboard polish (audit §10 Phase 4): micro-animations, keyboard nav (G-codes), mobile drawer slide-up, course color hashing. Plus accepted-gap edge cases (snow-day shift, trip mode, course archive, status-flap detection) from audit §7.
2. Convert action-oriented notes into reminders with user confirmation.
3. Unified single Task model (Option B).
4. Daily cost summary.

## Standard Release Flow (Mandatory for Agent Runtime Changes)
1. Preserve current committed prod Docker runtime as rollback target.
2. Run the Managed Agents dev stack against copied prod memory/state and keep parity artifacts.
3. Run agentic story suite and collect transcripts/tool snapshots.
4. Run one judge pass on artifacts and review evidence.
5. Execute user UAT only after judge pass.
6. Promote to production with canary prompts, explicit rollback command, cost/idle monitoring, and 24h stabilization.

## Tracking
- Backlog source of truth: `docs/BACKLOG.md`.
- Completed work log: `docs/COMPLETED.md`.

## Branch Governance
- `main` is the canonical planning source of truth (`docs/ROADMAP.md` + `docs/BACKLOG.md`).
- Feature branches may carry temporary planning edits during execution, but must reconcile to `main` before promotion.
- Managed Agents migration notes live under `docs/managed-agents/`; retired runtime notes are not active planning material.

## Execution Tracking Canon (2026-03-02)
- Execution status, intake state, and handoffs are tracked on the GitHub Project `FSM Engineering Board`.
- This roadmap remains strategic (goals, priorities, and direction), not the live execution board.
- Repo-local handoff ledger: `docs/WORKLOG.md`.
