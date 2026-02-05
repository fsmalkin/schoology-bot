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

## Data Flow
1. Scheduler triggers scrape -> Playwright logs in -> grades page parsed.
2. Assignments are normalized and stored in SQLite; state.json also updated.
3. Auto-ignore rules suppress prior-quarter/practice items (configurable).
4. Auto-planner creates reminders for upcoming assignments (configurable, default 4pm day before).
5. Summary builder reads DB (manual statuses honored).
6. Refresh replies summarize Actionable/Pending/Archived counts (not raw missing).
7. Telegram delivery formats summary with HTML-safe output.
8. Agent chat uses a structured planner to choose a tool and executes it.

## Deployment
- Local dev: `npm run start` and `npm run agent:telegram`.
- Docker: `docker compose up -d --build` (two services).
- Optional auto-update: `scripts/auto_update.ps1` to pull a branch and rebuild Docker (no CI/CD by default).
- CI (optional): GitHub Actions runs `npm test` on PRs/pushes to main with live tests disabled.

## Beta/Prod Separation
- Beta uses `.env.beta` with `DATA_DIR=data/beta`.
- Separate Docker Compose stack for beta.
- Promotion merges beta changes into main and rebuilds prod.

## Reliability
- Single agent instance enforced via lock file.
- Message batching to avoid duplicate responses.
- Health checks and restart policies in Docker.

## Future Enhancements
- Context compaction and long-term chat memory.
- Upcoming assignments ingestion + auto-reminder planning.
- Auto-ignore prior-quarter or non-graded items.
