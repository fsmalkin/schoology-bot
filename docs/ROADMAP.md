# Roadmap

## Goal
Build a local automation that logs into Schoology daily, finds missing assignments for Mayari, and sends a morning summary. Design it so it can be moved to a server later with minimal changes.

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
- Docker support included for easy server migration.
- If using Twilio later, use Auth Token for now; plan to switch to API Key for server move.
- Session-based login: use one-time interactive login locally; improve automated auth when moving to server.
- Add Telegram alert when re-authentication is required.
- Daily summary lists only unresolved items (Missing, Incomplete, Not completed/submitted, Absent).
- Agent model choice: GPT-5.2 (not mini or pro).
- Maintain offline unit + E2E tests using fixtures (no live Schoology needed).
- Daily summary includes tasks scheduled for today.
- Tasks roll over by 24 hours if not completed.
- Daily summary is DB-backed (manual statuses honored) and agentic for Telegram.
- Bug filing auto-generates a title when missing.
- Pending actions are stored per chat to complete multi-step confirmations.
- Bug filing uses a draft+validate+submit skill (no empty issues).
- Schoology "submitted but not graded" indicators are auto-archived (Ignored) in summaries/lists by default.

## Active Queue (P1)
1. DB-backed context compaction and long-thread memory (#14).
2. Detail-page fallback for ambiguous submission status (#15).
3. Auto-cancel assignment reminders when assignment becomes inactive/resolved (#10).

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
