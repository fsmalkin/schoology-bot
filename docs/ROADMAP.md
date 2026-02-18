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
- Tasks roll over by 24 hours if not completed.
- Daily summary is DB-backed (manual statuses honored) and agentic for Telegram.
- Local health dashboard is available at `http://127.0.0.1:8787` for service/data checks.
- Bug filing auto-generates a title when missing.
- Pending actions are stored per chat to complete multi-step confirmations.
- Bug filing uses a draft+validate+submit skill (no empty issues).
- Schoology "submitted but not graded" indicators are auto-archived (Ignored) in summaries/lists by default.
- OpenClaw beta runtime uses gateway-native Telegram + cron, with `schoology-tool-api` retained as a parity sidecar.

## Status Snapshot (2026-02-18)
- Delivered:
  - Runtime migrated from laptop to local server and is running in Docker Compose with health checks.
  - OpenClaw beta one-gateway runtime is running from one shared image (`schoology-beta-openclaw-unified:latest`).
  - Docker image sprawl reduced by consolidating gateway/tool-api/cron/monitor/dashboard onto one image build.
  - Login failure messaging now respects configured `SCHOLOGY_IDP` and avoids unnecessary provider-selection prompts.
- In progress:
  - Beta UAT for login refresh, missing-assignment flows, and reminder delivery before prod promotion.
  - Production rollout checklist and cutover validation for OpenClaw runtime.

## Active Queue (P1)
1. OpenClaw beta UAT and production promotion readiness.
2. DB-backed context compaction and long-thread memory (#14).
3. Detail-page fallback for ambiguous submission status (#15).
4. Auto-cancel assignment reminders when assignment becomes inactive/resolved (#10).
5. Finalize OpenClaw upstream sync SOP (what to pull, how to validate, when to promote).

## Ready Next (P2)
1. Recurring reminder support (create/edit/delete UX + tests).
2. OpenClaw upstream sync SOP (what to pull, how to validate, when to promote).
3. Scheduled auto-update task decision (Windows Task Scheduler).
4. Agents SDK evaluation versus current direct Responses architecture.

## Later (P3)
1. Convert action-oriented notes into reminders with user confirmation.
2. Unified single Task model (Option B).
3. Daily cost summary.
4. Local admin UI for status/notes/reminders.

## Tracking
- Backlog source of truth: `docs/BACKLOG.md`.
- Completed work log: `docs/COMPLETED.md`.

## Branch Governance
- `main` is the canonical planning source of truth (`docs/ROADMAP.md` + `docs/BACKLOG.md`).
- Feature branches may carry temporary planning edits during execution, but must reconcile to `main` before promotion.
- Beta/OpenClaw branch notes that are branch-specific should live under `docs/openclaw/`.
