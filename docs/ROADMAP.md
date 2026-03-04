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
- Availability target: run via Docker with restart policy + health check; update with `docker compose up -d --build`.
- Production runtime is hosted on the local server (Docker Compose).
- If using Twilio later, use Auth Token for now; plan to switch to API Key for server move.
- Session-based login: use one-time interactive login and refresh when session expires.
- Add Telegram alert when re-authentication is required.
- Daily summary lists only unresolved items (Missing, Incomplete, Not completed/submitted, Absent).
- Agent model choice: GPT-5.2 (not mini or pro).
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
- OpenClaw beta runtime uses gateway-native Telegram + cron, with `schoology-tool-api` retained as a parity sidecar.
- Coexistence guardrail: Schoology stacks use explicit Docker Compose project names (`schoology-prod`, `schoology-openclaw-beta`) to avoid conflicts with other local OpenClaw projects.
- Disaster-recovery automation uses scheduled backup + freshness checks with off-machine folder sync.
- Agentic release gate is mandatory before UAT for reminder-impacting releases:
  - Reset beta from prod memory.
  - Run agentic story suite.
  - Run one GPT-5.2 judge pass and review evidence.
  - Then execute user UAT.

## Status Snapshot (2026-02-22)
- Delivered:
  - Runtime migrated from laptop to local server and is running in Docker Compose with health checks.
  - OpenClaw beta one-gateway runtime is running from one shared image (`schoology-beta-openclaw-unified:latest`).
  - Docker image sprawl reduced by consolidating gateway/tool-api/cron/monitor/dashboard onto one image build.
  - Recovery runbook and operations scripts added for start/backup/restore/freshness/task registration.
  - Login failure messaging now respects configured `SCHOLOGY_IDP` and avoids unnecessary provider-selection prompts.
  - Recurring reminder runtime support implemented across DB, tool runner, and reminder scheduler (`daily`, `weekdays`, `weekly`).
- In progress:
  - Beta reset from prod memory + evidence artifact flow.
  - Agentic story suite run and single-pass GPT-5.2 judge evidence review before UAT.
  - Production rollout checklist and cutover validation for recurring reminder release.

## Active Queue (P1)
1. Recurring reminders release gate completion (beta reset, story suite, GPT-5.2 judge evidence, UAT, prod rollout).
2. OpenClaw beta UAT and production promotion readiness.
3. DB-backed context compaction and long-thread memory (#14).
4. Detail-page fallback for ambiguous submission status (#15).
5. Auto-cancel assignment reminders when assignment becomes inactive/resolved (#10).
6. Finalize OpenClaw upstream sync SOP (what to pull, how to validate, when to promote).

## Ready Next (P2)
1. OpenClaw upstream sync SOP (what to pull, how to validate, when to promote).
2. Scheduled auto-update task decision (Windows Task Scheduler).
3. Agents SDK evaluation versus current direct Responses architecture.
4. Extend the agentic release pattern to other projects and templates.

## Later (P3)
1. Convert action-oriented notes into reminders with user confirmation.
2. Unified single Task model (Option B).
3. Daily cost summary.
4. Local admin UI for status/notes/reminders.

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

