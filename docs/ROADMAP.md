# Roadmap

## Goal
Run a reliable Schoology assistant on the local server that refreshes assignments, keeps actionable status clean, and delivers clear daily/reminder updates via Telegram.

## Current Decisions
- Login uses Mayari username and password directly.
- MFA is not expected.
- Headless browser only.
- Credentials and config live in `.env`.
- Scrape runs at 6:00 AM ET, summary sent at 7:00 AM ET.
- Reminder scheduler runs every minute to deliver task reminders.
- Daily summary delivery via Telegram.
- Telegram agent runs as a single instance to avoid duplicate responses.
- Incoming Telegram messages are batched briefly and the oldest dropped if too long.
- Agent tool routing uses a multi-step structured-output planner (tool group -> tool picker -> augment).
- Tool execution is handled by app code (not model tool-calling).
- Availability target: run via Docker with restart policy + health check; update with `docker compose -p schoology-prod up -d --build`.
- Production runtime is hosted on the local server (Docker Compose).
- If using Twilio later, use Auth Token for now; plan to switch to API Key for server move.
- Session-based login: use one-time interactive login and refresh when session expires.
- Add Telegram alert when re-authentication is required.
- Daily summary lists only unresolved items (Missing, Incomplete, Not completed/submitted, Absent).
- Legacy prod agent model choice remains GPT-5.2 until the Claude Managed Agents cutover.
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
- OpenClaw beta is deprecated as a migration path and kept rollback-only; do not spend new implementation effort on OpenClaw UAT, cron hardening, or upstream sync unless explicitly requested.
- Claude Managed Agents is the top-priority replacement runtime: implement in dev first, validate against parity gates, then promote to prod.
- Managed Agents dev bridge now routes Telegram inbound through managed sessions when enabled; Claude custom tool requests execute through the existing deterministic tool runner in-process, and local scheduler/reminder delivery stays authoritative until parity and idle-cost controls are proven.
- Managed Agents dev/prod separation must keep distinct env, session mapping, data, health, and rollback boundaries.
- Existing OpenClaw beta reset/runtime commands remain legacy-only until the Managed Agents dev runtime replaces them.
- Disaster-recovery automation uses scheduled backup + freshness checks with off-machine folder sync.
- Agentic release gate is mandatory before UAT for agent runtime changes:
  - Run Managed Agents dev against copied prod memory/state.
  - Run agentic story suite.
  - Run one judge pass and review evidence.
  - Confirm rollback command plus cost/idle monitoring.
  - Then execute user UAT.

## Status Snapshot (2026-05-26)
- Delivered:
  - Runtime migrated from laptop to local server and is running in Docker Compose with health checks.
  - OpenClaw beta one-gateway runtime reached a usable rollback/reference state but is no longer the promotion target.
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
  - Managed Agents custom tool loop hardening started in [#29](https://github.com/fsmalkin/schoology-bot/issues/29): exported tool definitions, unsupported-tool errors, built-in tool denial, invalid-arg errors, bounded result payloads, and loop guardrails.
  - Managed Agents parity runner prep started in [#30](https://github.com/fsmalkin/schoology-bot/issues/30): the story suite now routes through `runChatMessage` and can target the Managed Agents bridge by env.
- In progress:
  - Claude Managed Agents live dev credentials/UAT, parity artifacts, and health/cost controls.
  - Dashboard Phase 1 polish remains useful but is behind the Managed Agents migration.

## Active Queue (P1)
1. [#25 Claude Managed Agents dev runtime and production cutover plan](https://github.com/fsmalkin/schoology-bot/issues/25) ([tracking doc](managed-agents/README.md)).
2. [#29 Managed Agents custom tool loop](https://github.com/fsmalkin/schoology-bot/issues/29): harden tool schemas/results, clarification turns, and failure behavior against the existing Schoology tool surface.
3. [#30 Managed Agents parity gate](https://github.com/fsmalkin/schoology-bot/issues/30): refresh, list missing, update status, notes, reminders, daily summary, Telegram UX, failure handling, and no duplicate responses.
4. [#31 Managed Agents observability/cost controls](https://github.com/fsmalkin/schoology-bot/issues/31): session mapping, idle/termination policy, event logs, health dashboard signal, and rollback switch to legacy prod.
5. Login/session resilience follow-up while keeping secrets-based unattended login (#18) parked unless strategy changes.

## Ready Next (P2)
1. Dashboard Phase 1: sidebar nav fix, course color stripes, mobile bottom tab bar, system status dot in right column.
2. Dashboard Phase 2: This Week view (calendar strip + day-lane layout).
3. Dashboard Phase 3: System panel demotion - slide-in panel instead of full nav view.
4. Dashboard Phase 4: Command palette.
5. Scheduled auto-update task decision (Windows Task Scheduler).
6. Claude Agent SDK evaluation only if Managed Agents blocks or self-hosted execution becomes a better fit.
7. Extend the agentic release pattern to other projects and templates.

## Later (P3)
1. Dashboard Phase 5: polish — course color hashing, micro-animations, keyboard nav (G-codes), mobile drawer slide-up.
2. Convert action-oriented notes into reminders with user confirmation.
3. Unified single Task model (Option B).
4. Daily cost summary.

## Standard Release Flow (Mandatory for Agent Runtime Changes)
1. Preserve current prod Docker runtime as rollback target.
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
- Managed Agents migration notes live under `docs/managed-agents/`; OpenClaw notes remain archived under `docs/openclaw/`.

## Execution Tracking Canon (2026-03-02)
- Execution status, intake state, and handoffs are tracked on the GitHub Project `FSM Engineering Board`.
- This roadmap remains strategic (goals, priorities, and direction), not the live execution board.
- Repo-local handoff ledger: `docs/WORKLOG.md`.
