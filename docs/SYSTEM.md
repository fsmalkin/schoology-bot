# System Reference

Purpose: single-page reference for how the Schoology bot works, how it runs, and where data lives.

## Services
- schoology (scheduler)
  - Runs cron jobs for scrape, summary send, and reminders.
- telegram-agent
  - Handles chat messages, tool routing, and responses.
- dashboard
  - Local health UI + JSON status endpoint for operations visibility.
- schoology-tool-api (optional, OpenClaw beta)
  - Exposes tools for OpenClaw gateway.
- openclaw-gateway (optional, OpenClaw beta)
  - Handles Telegram chat and cron scheduler in one runtime.
- openclaw-cron-sync (optional, OpenClaw beta)
  - Reconciles managed cron jobs on startup (scrape, summary, due reminders).
- openclaw-gateway-monitor (optional, OpenClaw beta)
  - Writes gateway heartbeat for dashboard visibility.
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
   - One-time reminders roll over by 24h if not completed.
   - Recurring reminders are expanded by cadence (`daily`, `weekdays`, `weekly`) in reminder runner logic.
4) Agent chat
   - Capability gate checks for unsupported requests and proposes nearest supported fallback.
   - Planner selects tools, executes, then composes final message.
   - Pending actions stored per chat for multi-step confirmations.
   - Reminder writes are agent-mediated with proactive assumptions + post-create confirmation:
     - missing recurring cadence defaults to weekdays on explicit recurring asks,
     - missing recurring time defaults to 7:00 AM / 4:30 PM / 9:00 PM ET by cue type,
     - unsupported cadence falls back to weekly with explicit warning.
5) Dashboard
   - Reads state.json, SQLite, and heartbeat files.
   - Shows service freshness + assignment/task health at a glance.

## Data and logs
- data/state.json
  - Last scrape timestamps and raw assignment cache.
- data/agent.db
  - SQLite for assignments, unified task/reminder records, notes, chat_state.
- artifacts/beta-reset/*
  - Beta reset snapshots and parity report artifacts.
- artifacts/agentic-story-suite/*
  - Story transcripts, tool snapshots, and judge evidence JSON artifacts.
- data/bugs.log
  - Local bug/feature drafts (JSON lines).
- data/agent.log
  - Telegram agent log (chat activity).
- data/health/*.heartbeat.json
  - Service heartbeat files for scheduler/agent/dashboard.

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
- Dashboard: `npm run dashboard`
- Interactive login: `npm run login:interactive`
- Tests: `npm test`
- Agentic stories: `npm run stories:run`
- Agentic judge: `npm run stories:judge`
- Beta reset from prod memory: `npm run beta:reset-memory`

## Docker
Image strategy:
- Default stack reuses one shared image tag (`schoology-app:latest`) across scheduler, telegram-agent, and dashboard.
- Legacy beta stack reuses one shared image tag (`schoology-beta-app:latest`) across scheduler and telegram-agent.
- OpenClaw beta stack reuses one shared image tag (`schoology-beta-openclaw-unified:latest`) across gateway/tool-api/cron/monitor/dashboard.
- OpenClaw beta dashboard is profile-gated (`dashboard`) and off by default.
- Legacy beta should run on demand under a separate project name (`schoology-beta`) to avoid overlap with prod.

Default:
- `docker compose up -d --build`
- `docker compose logs --tail 200 telegram-agent`
- `docker compose logs --tail 200 schoology`
- `docker compose logs --tail 200 dashboard`

Beta (Legacy Telegram):
- `docker compose --env-file .env.beta -f docker-compose.beta.yml -p schoology-beta up -d --build`
- `docker compose --env-file .env.beta -f docker-compose.beta.yml -p schoology-beta logs --tail 200 schoology-beta`
- `docker compose --env-file .env.beta -f docker-compose.beta.yml -p schoology-beta logs --tail 200 telegram-agent-beta`
- `docker compose --env-file .env.beta -f docker-compose.beta.yml -p schoology-beta down`

Beta (OpenClaw):
- `docker compose --env-file .env.beta -f docker-compose.beta-openclaw.yml -p openclaw-beta up -d --build`
- `docker compose --env-file .env.beta -f docker-compose.beta-openclaw.yml -p openclaw-beta logs --tail 200 openclaw-cron-sync`
- `docker compose --env-file .env.beta -f docker-compose.beta-openclaw.yml -p openclaw-beta logs --tail 200 openclaw-gateway`
- `docker compose --env-file .env.beta -f docker-compose.beta-openclaw.yml -p openclaw-beta logs --tail 200 schoology-tool-api`
- `docker compose --env-file .env.beta -f docker-compose.beta-openclaw.yml -p openclaw-beta --profile dashboard up -d dashboard`
- `docker compose --env-file .env.beta -f docker-compose.beta-openclaw.yml -p openclaw-beta logs --tail 200 dashboard` (when profile enabled)

## Known constraints
- Recurring cadence is limited to `daily`, `weekdays`, `weekly`.
- Schoology login is session-based; interactive login required when session expires.
- Production Telegram bot should be single-instance to avoid duplicate messages.
- Release gate for reminder-scope changes is mandatory before UAT:
  - beta reset from prod memory,
  - agentic story suite,
  - one GPT-5.2 judge run with evidence artifact.
