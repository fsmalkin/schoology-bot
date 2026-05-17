# Roadmap

## Goal
Run a reliable Schoology assistant on the local server that refreshes assignments, keeps actionable status clean, and delivers clear daily/reminder updates via Telegram while preserving the core Schoology workflow as the agent shell/runtime is evaluated.

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
- Product boundary: preserve core functions regardless of agent shell/runtime choice: Schoology refresh/scrape, assignment normalization, manual statuses, notes, reminders/tasks, daily summaries, dashboard health, deterministic tool execution, local state, and Telegram delivery until intentionally replaced.
- Next strategic decision: choose the default agent shell/runtime path before further wrapper/runtime promotion: Claude App, GPT app, or managed agent.
- Availability target: run via Docker with restart policy + health check; update with `docker compose -p schoology-prod up -d --build`.
- Production runtime is hosted on the local server (Docker Compose).
- If using Twilio later, use Auth Token for now; plan to switch to API Key for server move.
- Session-based login: use one-time interactive login and refresh when session expires.
- Add Telegram alert when re-authentication is required.
- Daily summary lists only unresolved items (Missing, Incomplete, Not completed/submitted, Absent).
- Current production agent model choice: GPT-5.2 (not mini or pro); the upcoming runtime decision may change the app shell and/or provider, but not the core Schoology tool boundary.
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
- OpenClaw beta runtime uses gateway-native Telegram + cron, with `schoology-tool-api` retained as a parity sidecar.
- Coexistence guardrail: Schoology stacks use explicit Docker Compose project names (`schoology-prod`, `schoology-openclaw-beta`) to avoid conflicts with other local OpenClaw projects.
- Beta reset command (`npm run beta:reset-memory`) targets the active OpenClaw beta runtime (`schoology-openclaw-beta`, `data/beta/*`); legacy beta compose is rollback-only.
- Beta runtime DB is `data/beta/agent.runtime.db`; reset/restore must install it via container-side copy so SQLite can open the bind-mounted file reliably on Windows.
- Disaster-recovery automation uses scheduled backup + freshness checks with off-machine folder sync.
- Agentic release gate is mandatory before UAT for reminder-impacting releases:
  - Reset beta from prod memory.
  - Run agentic story suite.
  - Run one GPT-5.2 judge pass and review evidence.
  - Then execute user UAT.

## Status Snapshot (2026-03-23)
- Delivered:
  - Runtime migrated from laptop to local server and is running in Docker Compose with health checks.
  - OpenClaw beta one-gateway runtime is running from one shared image (`schoology-beta-openclaw-unified:latest`).
  - Docker image sprawl reduced by consolidating gateway/tool-api/cron/monitor/dashboard onto one image build.
  - Beta reset from prod memory now syncs prod DB/state into `data/beta` for the active OpenClaw beta stack and emits parity artifacts.
  - Recovery runbook and operations scripts added for start/backup/restore/freshness/task registration.
  - Login failure messaging now respects configured `SCHOLOGY_IDP` and avoids unnecessary provider-selection prompts.
  - Recurring reminder runtime support implemented across DB, tool runner, and reminder scheduler (`daily`, `weekdays`, `weekly`).
  - Dashboard redesigned with dark sidebar nav, 4-card metric row, and 2-column home layout (assignment sections + right-col panels). Replaces the hero/tab-bar shell. Section labels updated for clarity (`Tonight's Assignments`, `Waiting on Teacher`).
  - Schoology title derivation: assignments with no link title now derive a clean display name from the raw Schoology row text.
  - MUA/external-tool-link scrape correctness wave delivered: score-vs-missing conflict handling, detail-page fallback for ambiguous rows, stable assignment identity refresh, auto-cancel-on-resolve reminder cleanup, DB-backed chat memory/style persistence, plain-language formatting, richer follow-up replies, and `Will complete in class` status support.
  - Reminder-scope release gate completed for this wave: `npm run beta:reset-memory`, `npm run stories:run`, `npm run stories:judge`, prod rebuild, and beta/prod dashboard health checks.
  - Full dashboard design plan written (`docs/DASHBOARD_DESIGN.md`): user stories, navigation architecture, view designs, interaction patterns, mobile layout, and implementation phases.
- In progress:
  - Agent shell/runtime decision: choose Claude App, GPT app, or managed agent while preserving the existing Schoology core functions and deterministic tool boundary.
  - Dashboard Phase 1 polish: sidebar nav fix, course color stripes, mobile bottom tab bar.
  - OpenClaw cron bootstrap reliability (`openclaw_cron_sync`) still relies on runtime retries/log validation rather than deterministic integration coverage.

## Agent Shell/Runtime Decision Gate (Next Step)
Choose the default user-facing agent shell/runtime before further promotion of the OpenClaw beta path or a new Telegram wrapper. The decision should compare:

1. Claude App path
   - Can it preserve the current parent-facing workflow with minimal custom runtime surface?
   - Can it call the Schoology tool boundary safely through MCP/tool API or another deterministic bridge?
2. GPT app path
   - Can it preserve the current Telegram/dashboard experience or replace it with an acceptable GPT-native surface?
   - Can it retain reliable scheduled summaries, reminders, and local/server state?
3. Managed agent path
   - Can it run long-lived or scheduled Schoology workflows without weakening credential/session handling?
   - Does it reduce runtime burden enough to justify added platform coupling?

Decision requirements:
- Preserve core functions listed in Current Decisions.
- Keep Schoology actions deterministic and app-executed; the model may plan, but code performs writes.
- Keep local/server data ownership unless an explicit migration decision is made.
- Require parity checks for refresh, summary, reminders, status updates, notes, dashboard health, and failure alerts.
- Produce a short decision memo with selected path, rejected alternatives, migration steps, and rollback plan.

## Active Queue (P1)
1. Agent shell/runtime decision gate: choose Claude App, GPT app, or managed agent while preserving core Schoology functions.
2. OpenClaw beta UAT and production promotion readiness.
3. Dashboard Phase 1: sidebar nav fix, course color stripes, mobile bottom tab bar, system status dot in right column.
4. OpenClaw cron bootstrap hardening and explicit test coverage.
5. Login/session resilience follow-up while keeping secrets-based unattended login (#18) parked unless strategy changes.

## Ready Next (P2)
1. Dashboard Phase 2: This Week view (calendar strip + day-lane layout).
2. Dashboard Phase 3: System panel demotion — slide-in panel instead of full nav view.
3. Dashboard Phase 4: Command palette (⌘K).
4. OpenClaw upstream sync SOP (what to pull, how to validate, when to promote).
5. Scheduled auto-update task decision (Windows Task Scheduler).
6. Provider/SDK follow-through after agent shell/runtime decision.
7. Extend the agentic release pattern to other projects and templates.

## Later (P3)
1. Dashboard Phase 5: polish — course color hashing, micro-animations, keyboard nav (G-codes), mobile drawer slide-up.
2. Convert action-oriented notes into reminders with user confirmation.
3. Unified single Task model (Option B).
4. Daily cost summary.

## Standard Release Flow (Mandatory for Reminder-Scope Changes)
1. Run beta reset from prod memory and keep report artifact.
2. Run agentic story suite and collect transcripts/tool snapshots.
3. Run one GPT-5.2 judge pass on artifacts and review evidence.
4. Execute user UAT only after judge pass.
5. Promote to production with canary prompts and 24h stabilization.

## Tracking
- Backlog source of truth: `docs/BACKLOG.md`.
- Completed work log: `docs/COMPLETED.md`.

## Branch Governance
- `main` is the canonical planning source of truth (`docs/ROADMAP.md` + `docs/BACKLOG.md`).
- Feature branches may carry temporary planning edits during execution, but must reconcile to `main` before promotion.
- Beta/OpenClaw branch notes that are branch-specific should live under `docs/openclaw/`.

## Execution Tracking Canon (2026-03-02)
- Execution status, intake state, and handoffs are tracked on the GitHub Project `FSM Engineering Board`.
- This roadmap remains strategic (goals, priorities, and direction), not the live execution board.
- Repo-local handoff ledger: `docs/WORKLOG.md`.
