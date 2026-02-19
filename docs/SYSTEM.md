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
   - Ambiguous list rows can use detail-page fallback parsing (bounded by config).
   - Updates state.json and syncs into SQLite.
2) Summary send
   - Builds DB-backed summary (actionable + pending; archived hidden by default).
   - Submitted-but-ungraded Schoology rows are auto-archived.
   - Sends via Telegram (agentic if OpenAI key is set).
3) Reminders
   - Pending tasks due now trigger Telegram reminders.
   - Assignment-linked reminders can auto-cancel when the assignment is inactive/resolved.
   - Reminders roll over by 24h if not completed.
4) Agent chat
   - Capability gate checks for unsupported requests and proposes nearest supported fallback.
   - Planner selects tools, executes, then composes final message.
   - Pending actions stored per chat for multi-step confirmations.
5) Dashboard
   - Reads state.json, SQLite, and heartbeat files.
   - Shows service freshness + assignment/task health at a glance.

## Data and logs
- data/state.json
  - Last scrape timestamps and raw assignment cache.
- data/agent.db
  - SQLite for assignments, tasks, notes, reminders, chat_state.
- data/bugs.log
  - Local bug/feature drafts (JSON lines).
- data/agent.log
  - Telegram agent log (chat activity).
- data/health/*.heartbeat.json
  - Service heartbeat files for scheduler/agent/dashboard.

## Configuration (env)
Key settings:
- SCHOLOGY_USERNAME / SCHOLOGY_PASSWORD
- SCHOLOGY_USERNAME_FILE / SCHOLOGY_PASSWORD_FILE (optional secret-file credentials)
- STORAGE_STATE_B64 / STORAGE_STATE_B64_FILE (optional base64 storage-state bootstrap)
- STORAGE_STATE_ENC_B64 / STORAGE_STATE_ENC_B64_FILE / STORAGE_STATE_ENC_KEY (optional encrypted bootstrap)
- TIMEZONE (defaults to America/New_York)
- SCRAPE_CRON / SEND_CRON / REMINDER_CRON
- SCRAPE_DETAIL_FALLBACK_ENABLED / SCRAPE_DETAIL_FALLBACK_MAX
- AUTO_CANCEL_RESOLVED_ASSIGNMENT_REMINDERS
- TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_IDS
- OPENAI_API_KEY / OPENAI_MODEL / OPENAI_REASONING_EFFORT
- OPENAI_DB_MEMORY_ENABLED
- AUTO_IGNORE_* and AUTO_UPCOMING_*
- LIVE_CHECK_* (disabled by default)

## Commands
- Run scheduler: `npm start`
- One-off scrape: `npm run scrape`
- One-off summary: `npm run send`
- Telegram agent: `npm run agent:telegram`
- Dashboard: `npm run dashboard`
- Interactive login: `npm run login:interactive`
- Encrypt storage state for secrets: `npm run storage:encrypt -- --input data/storage.json --output data/storage_state.enc.b64`
- Tests: `npm test`

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
- No recurring reminders (one-time only).
- Schoology login is session-based; interactive login is still needed when session/credentials are unavailable.
- Production Telegram bot should be single-instance to avoid duplicate messages.
