# Architecture

## Overview
The system is a local-first automation that:
1) Logs into Schoology and scrapes grades.
2) Stores assignment history and manual metadata in SQLite.
3) Sends daily summaries and reminders via Telegram.
4) Exposes an agentic chat interface for updates and questions.

## Components
- `schoology` service (scheduler)
  - Scrape Schoology at 6:00 AM ET.
  - Send daily summary at 7:00 AM ET.
  - Deliver task reminders on a schedule (default every minute).
- `telegram-agent` service
  - Receives chat messages.
  - Uses GPT-5.2 for structured tool planning.
  - Executes tool actions in code (not model tool calls) for reliability.
- `dashboard` service
  - Serves local operations UI (`/`) and health API (`/api/health`).
  - Aggregates state from heartbeat files + SQLite + state.json.
- Claude Managed Agents runtime (dev replacement path)
  - Managed session bridge maps Telegram chats to Claude managed sessions.
  - Claude custom tool requests execute deterministic Schoology/task tools through app code.
  - Local scheduler/reminder delivery remains authoritative until parity and cost gates prove otherwise.

## Data Stores
- `data/agent.db` (SQLite)
  - `assignments`: normalized assignment records.
  - `assignment_notes`: user notes.
  - `tasks`: reminders and personal tasks.
  - `reminders`: legacy reminders (migrated into tasks).
  - `chat_state`: per-chat state and turn counters.
  - `pending_actions`: multi-step confirmation state.
- `data/state.json`: scrape state and legacy assignment history.
- `data/storage.json`: Playwright session storage for login reuse.
- `data/health/*.heartbeat.json`: service heartbeats for scheduler, telegram-agent, and dashboard.
- `data/beta/health/*.heartbeat.json`: beta service heartbeats. Managed Agents health work will add bridge/session health under [#31](https://github.com/fsmalkin/schoology-bot/issues/31).

## Data Flow
1. Scheduler triggers scrape -> Playwright logs in -> grades page parsed.
2. Assignments are normalized and stored in SQLite; state.json also updated.
3. Auto-ignore rules suppress prior-quarter/practice items (configurable).
4. Auto-planner creates reminders for upcoming assignments (configurable, default 4pm day before).
5. Summary builder reads DB (manual statuses honored).
6. Submitted-but-ungraded rows are auto-archived so they do not appear as active missing work.
7. Refresh replies summarize Actionable/Pending/Archived counts (not raw missing).
8. Telegram delivery formats summary with HTML-safe output.
9. Agent chat uses a structured planner to choose a tool and executes it.
10. Dashboard reads local state + DB + heartbeats for at-a-glance health.

## Deployment
- Local dev: `npm run start` and `npm run agent:telegram`.
- Primary runtime: Docker Compose via `scripts/start_schoology_stacks.ps1 -RuntimeMode docker`.
- Optional auto-update: `scripts/auto_update.ps1` to pull a branch and rebuild Docker (no CI/CD by default).
- CI (optional): GitHub Actions runs `npm test` on PRs/pushes to main with live tests disabled.

## Beta/Prod Separation
- Beta uses `.env.beta` with `DATA_DIR=data/beta`.
- Managed Agents dev runtime must remain separate from prod and preserve rollback to the current committed Docker prod runtime.
- Promotion merges beta changes into main and rebuilds prod.

## Reliability
- Single agent instance enforced via lock file.
- Message batching to avoid duplicate responses.
- Health checks and restart policies in native systemd services.

## Future Enhancements
- Claude Managed Agents bridge live UAT, parity tests, health/cost controls, and production cutover.
- Managed-session observability, idle/cost controls, and current-prod-Docker rollback automation.
