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

## Phase 1
Scope:
- Log in to Schoology and reach grades page.
- Detect missing assignments from the grades view.
- Persist assignment history and resolved items.
- Send daily summary message (SMS or email).

Deliverables:
- Local scheduler for scrape and send.
- Data store for state history.
- Summary content with unresolved items only (missing/incomplete/not submitted/absent).

Acceptance:
- 6:00 AM ET scrape updates state successfully.
- 7:00 AM ET summary is delivered.
- Summary lists all unresolved items with clear class names and due dates.

Risks:
- Login flow changes or new MFA prompt.
- Page layout changes on Schoology.
- Missing assignments not labeled consistently.

Rollback:
- Stop scheduler process.
- Remove `.env` and `data/` directory.

## Phase 2
Scope:
- Track manual statuses and notes not in Schoology, such as "waiting on teacher".
- Keep manual data linked to assignments.
- Show manual status and notes in daily summary.

Deliverables:
- Manual status and notes storage.
- Commands to set status, add notes, resolve, reopen.

Acceptance:
- Notes and status persist across runs.
- Summary includes manual notes where present.

Risks:
- Assignment matching drift.

Rollback:
- Delete manual notes storage.

## Phase 3 (Agentic Chat + Tools)
Scope:
- Add a chat-driven agent layer that can answer questions about assignments.
- Let users update assignment statuses and add notes through chat.
- Schedule reminders for followups on specific assignments.
- CRUD personal tasks with reminders via chat.

Implementation approach:
- Use OpenAI Responses API with GPT-5.2 for agent responses and tool calling.
- Optional: wrap tools with the OpenAI Agents SDK for tracing and orchestration.
- Optional: add context compaction for long-running chats.

Deliverables:
- Tool endpoints: list assignments, update status, add note, schedule reminder.
- Tool endpoints: create/list/update/delete tasks with reminders.
- Tool endpoint: refresh Schoology on demand and reconcile manual statuses.
- Local storage for notes and reminders (SQLite or JSON).
- Telegram bridge to agent (natural language, not brittle commands).
- Feature request logging via agent tool.

Acceptance:
- "What is missing this week?" returns accurate summary.
- "Mark Algebra HW 3 as waiting on teacher" updates stored status.
- "Remind me about Lab Report on Friday at 7pm" schedules a reminder.
- "Remind me to ask a friend tonight at 9pm" creates a task and sends a reminder.
- "Check again, I turned that in" refreshes Schoology and clears only safe manual statuses.
- Rapid multi-message prompts are combined into a single agent request.

Risks:
- Cost and latency for longer conversations.
- Tool misuse if guardrails are weak.
- Context window limits for long chat history.

Rollback:
- Disable agent mode and keep standard daily summary.

## Phase 4 (Cost Monitoring)
Scope:
- Track daily and total OpenAI API spend.
- Send a daily cost summary message.

Deliverables:
- Cost tracker that aggregates usage by day and total.
- Daily Telegram message with spend totals.

Acceptance:
- Daily summary shows yesterday's spend and month-to-date total.

Risks:
- API usage reporting delays.

Rollback:
- Disable cost summary message.

## Phase 5 (Local Web UI)
Scope:
- Provide a small local webpage to view assignments and update statuses/notes.
- Avoid brittle text-only commands for manual updates.

Deliverables:
- Local web UI with authentication (local-only).
- Forms to edit status, add notes, and schedule reminders.

Acceptance:
- Manual updates can be made reliably from the web UI.

Risks:
- Additional local service to run.

Rollback:
- Stop the web UI process.

## Execution Sequence
1. Build and validate Phase 1 locally.
2. Harden scheduler and add retries or alerts.
3. Add Phase 2 manual status and notes.
4. Add Phase 3 messaging agent.

## Open Items
- Provide Telegram bot token and chat IDs.
- Optional: Provide Twilio credentials for SMS fallback.
- Optional: Provide SMTP credentials for email fallback.
- Decide when to switch to Twilio API Key credentials.
- Provide OpenAI API key for agent integration.
- Choose GPT model tier (gpt-5.2 vs gpt-5.2-pro vs gpt-5-mini).
- Decide whether to use Agents SDK or direct Responses API.
