# Roadmap

## Goal
Run a reliable Schoology assistant on the local server that refreshes assignments, keeps actionable status clean, and delivers clear daily/reminder updates via Telegram while preserving the deterministic Schoology workflow through the Claude Managed Agents migration.

## Current Decisions
- Login uses Mayari username and password directly.
- MFA is not expected.
- Headless browser only for unattended scrape/runtime work; interactive browser login is used to refresh storage when needed.
- Credentials and config live in `.env`.
- Scrape runs at 6:00 AM ET, summary sent at 7:00 AM ET.
- Reminder scheduler runs every minute to deliver task reminders.
- Daily summary delivery via Telegram.
- Telegram agent runs as a single instance to avoid duplicate responses.
- Incoming Telegram messages are batched briefly and the oldest dropped if too long.
- Product boundary: preserve core functions regardless of agent shell/runtime choice: Schoology refresh/scrape, assignment normalization, manual statuses, notes, reminders/tasks, daily summaries, dashboard health, deterministic tool execution, local/server state, and Telegram delivery until intentionally replaced.
- Agent shell/runtime decision gate selected Claude Managed Agents over Claude App, GPT app, and OpenClaw as the dev-to-prod migration path.
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
- OpenClaw is rejected as a runtime and should be removed from code, compose files, scripts, and active docs under [#34](https://github.com/fsmalkin/schoology-bot/issues/34). The rollback target is the current committed Docker prod runtime, not OpenClaw.
- Claude Managed Agents is the top-priority replacement runtime: implement in dev first, validate against parity gates, then promote to prod.
- Managed Agents dev bridge routes Telegram inbound through managed sessions when enabled; Claude custom tool requests execute through the existing deterministic tool runner in-process, and local scheduler/reminder delivery stays authoritative until parity and idle-cost controls are proven.
- Managed Agents dev/prod separation must keep distinct env, session mapping, data, health, and rollback boundaries.
- Existing OpenClaw beta reset/runtime commands are pending deletion; do not use them for new UAT or rollback planning.
- Disaster-recovery automation uses scheduled backup + freshness checks with off-machine folder sync.
- Agentic release gate is mandatory before UAT for agent runtime changes:
  - Run Managed Agents dev against copied prod memory/state.
  - Run agentic story suite.
  - Run one judge pass and review evidence.
  - Confirm rollback command plus cost/idle monitoring.
  - Then execute user UAT.

## Status Snapshot (2026-05-27)
- Delivered:
  - Runtime migrated from laptop to local server and is running in Docker Compose with health checks.
  - OpenClaw beta one-gateway runtime reached a usable historical state but is no longer a rollback/reference target and is scheduled for removal in [#34](https://github.com/fsmalkin/schoology-bot/issues/34).
  - Agent shell/runtime decision gate completed: Claude Managed Agents is the selected replacement path while deterministic Schoology tool execution and local/server state ownership remain intact.
  - Recovery runbook and operations scripts added for start/backup/restore/freshness/task registration.
  - Login failure messaging now respects configured `SCHOLOGY_IDP` and avoids unnecessary provider-selection prompts.
  - Recurring reminder runtime support implemented across DB, tool runner, and reminder scheduler (`daily`, `weekdays`, `weekly`).
  - Dashboard redesigned with dark sidebar nav, 4-card metric row, and 2-column home layout (assignment sections + right-col panels). Replaces the hero/tab-bar shell. Section labels updated for clarity (`Tonight's Assignments`, `Waiting on Teacher`).
  - Schoology title derivation: assignments with no link title now derive a clean display name from the raw Schoology row text.
  - MUA/external-tool-link scrape correctness wave delivered: score-vs-missing conflict handling, detail-page fallback for ambiguous rows, stable assignment identity refresh, auto-cancel-on-resolve reminder cleanup, DB-backed chat memory/style persistence, plain-language formatting, richer follow-up replies, and `Will complete in class` status support.
  - Reminder-scope release gate completed for this wave: `npm run beta:reset-memory`, `npm run stories:run`, `npm run stories:judge`, prod rebuild, and beta/prod dashboard health checks.
  - Full dashboard design plan written (`docs/DASHBOARD_DESIGN.md`): user stories, navigation architecture, view designs, interaction patterns, mobile layout, and implementation phases.
  - Managed Agents config/session mapping foundation delivered in [#27](https://github.com/fsmalkin/schoology-bot/issues/27).
  - Managed Agents Telegram dev bridge foundation delivered in [#28](https://github.com/fsmalkin/schoology-bot/issues/28): runtime router, Claude session event client, assistant text streaming, and mock custom Schoology tool result flow.
  - Managed Agents custom tool loop hardening started in [#29](https://github.com/fsmalkin/schoology-bot/issues/29): exported tool definitions, unsupported-tool errors, built-in tool denial, invalid-arg errors, bounded result payloads, loop guardrails, and duplicate action-id dedupe.
  - Managed Agents parity runner prep and live dev evidence delivered in [#30](https://github.com/fsmalkin/schoology-bot/issues/30): story suite routing through `runChatMessage`, live story judge artifacts, scoped JTBD UAT, beta Schoology auth refresh, and live `refresh_schoology` repro against real Schoology data.
- In progress:
  - Capture one fresh inbound beta-thread Telegram message against the current Dockerized `schoology-managed-dev-telegram-agent`.
  - Remove OpenClaw code/repo artifacts in [#34](https://github.com/fsmalkin/schoology-bot/issues/34) before prod canary.
  - Continue [#31](https://github.com/fsmalkin/schoology-bot/issues/31) health, event log, and idle cost controls before any prod canary.
  - Dashboard Phase 1 polish remains useful but is behind the Managed Agents migration.

## Agent Shell/Runtime Decision Gate (Completed)
The May 17 planning gate compared Claude App, GPT app, and managed agent paths. The selected path is Claude Managed Agents because it best preserves the current Telegram/dashboard workflow while reducing self-hosted agent-runtime burden.

Decision requirements that remain active:
- Preserve core functions listed in Current Decisions.
- Keep Schoology actions deterministic and app-executed; the model may plan, but code performs writes.
- Keep local/server data ownership unless an explicit migration decision is made.
- Require parity checks for refresh, summary, reminders, status updates, notes, dashboard health, and failure alerts.
- Maintain rollback to the existing Docker prod runtime until the managed path passes prod canary gates. Do not use OpenClaw as rollback.

## Active Queue (P1)
1. [#25 Claude Managed Agents dev runtime and production cutover plan](https://github.com/fsmalkin/schoology-bot/issues/25) ([tracking doc](managed-agents/README.md)).
2. [#30 Managed Agents parity gate](https://github.com/fsmalkin/schoology-bot/issues/30): refresh, list missing, update status, notes, reminders, daily summary, Telegram UX, failure handling, and no duplicate responses.
3. [#34 Remove OpenClaw code and repo artifacts](https://github.com/fsmalkin/schoology-bot/issues/34): delete OpenClaw source, compose, scripts, tests, and active docs; keep current prod Docker as rollback.
4. [#31 Managed Agents observability/cost controls](https://github.com/fsmalkin/schoology-bot/issues/31): session mapping, idle/termination policy, event logs, health dashboard signal, and rollback switch to current prod Docker.
5. [#32 Managed Agents prod canary, rollback, and stabilization](https://github.com/fsmalkin/schoology-bot/issues/32).
6. Login/session resilience follow-up while keeping secrets-based unattended login (#18) parked unless strategy changes.

## Ready Next (P2)
1. Dashboard Phase 1: sidebar nav fix, course color stripes, mobile bottom tab bar, system status dot in right column.
2. Dashboard Phase 2: This Week view (calendar strip + day-lane layout).
3. Dashboard Phase 3: System panel demotion - slide-in panel instead of full nav view.
4. Dashboard Phase 4: Command palette.
5. Scheduled auto-update task decision (Windows Task Scheduler).
6. Claude Agent SDK fallback evaluation only if Managed Agents blocks or self-hosted execution becomes a better fit.
7. Extend the agentic release pattern to other projects and templates.

## Later (P3)
1. Dashboard Phase 5: polish - course color hashing, micro-animations, keyboard nav (G-codes), mobile drawer slide-up.
2. Convert action-oriented notes into reminders with user confirmation.
3. Unified single Task model (Option B).
4. Daily cost summary.

## Standard Release Flow (Mandatory for Agent Runtime Changes)
1. Preserve current committed prod Docker runtime as rollback target; OpenClaw is not a rollback path.
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
- Managed Agents migration notes live under `docs/managed-agents/`; OpenClaw notes are removal/archive candidates under [#34](https://github.com/fsmalkin/schoology-bot/issues/34), not active planning material.

## Execution Tracking Canon (2026-03-02)
- Execution status, intake state, and handoffs are tracked on the GitHub Project `FSM Engineering Board`.
- This roadmap remains strategic (goals, priorities, and direction), not the live execution board.
- Repo-local handoff ledger: `docs/WORKLOG.md`.
