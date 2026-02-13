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

## Now
1. Stabilize production UX after submitted-item archiving:
   - Verify refresh and daily summary language is clear (Actionable vs Pending vs Archived).
   - Confirm submitted/ungraded items stay out of "needs action" by default.
2. Tool capability awareness:
   - Add a capability registry so the agent knows exactly what each tool can/cannot do.
   - Reduce "I cannot do that" confusion for reminders/ticketing.
3. Skill router:
   - Load only relevant skills per request to reduce prompt bloat and improve tool selection.
4. Long-term memory + context compaction:
   - Add rolling chat summaries (DB-backed) and bounded replay windows.
5. Submission signal hardening:
   - Add assignment detail-page fallback parsing for submitted timestamp/status when list view is ambiguous.

## Next (Stack Ranked)
1. Choose library baseline for agent orchestration (keep current Responses flow vs adopt Agents SDK/AgentSkills).
2. Define compaction policy (trigger, scope, summary format, rollback path).
3. Add recurring reminder support (with clear edit/delete UX).
4. Decide if/when to add scheduled auto-update task (Windows Task Scheduler).
5. Define OpenClaw upstream sync SOP (what to pull, how to validate, when to promote).

## Later
- Convert action-oriented notes into reminders when appropriate (ask user to confirm).
- Unified single Task model (Option B).
- Phase 4 (Cost Monitoring): daily cost summary message.
- Phase 5 (Local Web UI): local admin UI for status/notes/reminders.

## Open Items
- Optional: Twilio/SMS path (not fully tested).
- Optional: SMTP email delivery.
- Decide whether to use Agents SDK or direct Responses API.
