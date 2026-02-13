# System Reference

Purpose: single-page reference for how the Schoology bot works, how it runs, and where data lives.

## Services
- schoology (scheduler)
  - Runs cron jobs for scrape, summary send, and reminders.
- telegram-agent
  - Handles chat messages, tool routing, and responses.
- schoology-tool-api (optional, OpenClaw beta)
  - Exposes tools for OpenClaw gateway.
- openclaw-gateway (optional, OpenClaw beta)
  - UI and tool router for OpenClaw evaluations.

## Core flows
1) Scrape
   - Playwright login -> grades page -> parse missing assignments.
   - Updates state.json and syncs into SQLite.
2) Summary send
   - Builds DB-backed summary (actionable + pending; archived hidden by default).
   - Submitted-but-ungraded Schoology rows are auto-archived.
   - Sends via Telegram (agentic if OpenAI key is set).
3) Reminders
   - Pending tasks due now trigger Telegram reminders.
   - Reminders roll over by 24h if not completed.
4) Agent chat
   - Planner selects tools, executes, then composes final message.
   - Pending actions stored per chat for multi-step confirmations.

## Data and logs
- data/state.json
  - Last scrape timestamps and raw assignment cache.
- data/agent.db
  - SQLite for assignments, tasks, notes, reminders, chat_state.
- data/bugs.log
  - Local bug/feature drafts (JSON lines).
- data/agent.log
  - Telegram agent log (chat activity).

## Configuration (env)
Key settings:
- SCHOLOGY_USERNAME / SCHOLOGY_PASSWORD
- TIMEZONE (defaults to America/New_York)
- SCRAPE_CRON / SEND_CRON / REMINDER_CRON
- TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_IDS
- OPENAI_API_KEY / OPENAI_MODEL / OPENAI_REASONING_EFFORT
- AUTO_IGNORE_* and AUTO_UPCOMING_*
- LIVE_CHECK_* (disabled by default)

## Commands
- Run scheduler: `npm start`
- One-off scrape: `npm run scrape`
- One-off summary: `npm run send`
- Telegram agent: `npm run agent:telegram`
- Interactive login: `npm run login:interactive`
- Tests: `npm test`

## Docker
Default:
- `docker compose up -d --build`
- `docker compose logs --tail 200 telegram-agent`
- `docker compose logs --tail 200 schoology`

Beta (OpenClaw):
- `docker compose --env-file .env.beta -f docker-compose.beta-openclaw.yml -p schoology-beta-openclaw up -d --build`

## Known constraints
- No recurring reminders (one-time only).
- Schoology login is session-based; interactive login required when session expires.
- Production Telegram bot should be single-instance to avoid duplicate messages.
