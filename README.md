# Schoology Bot

A friendly, local-first Schoology assistant that logs in, finds missing assignments, sends a daily summary, and lets you chat with an agent to update statuses, add notes, schedule reminders, and manage tasks.

It runs on your machine today and is ready to move to a server later.

## What it does
- Scrapes Schoology grades and detects missing or incomplete work.
- Sends a daily summary via Telegram (SMS or email optional).
- Provides an agentic chat interface (GPT-5.2) to answer questions and update statuses.
- Stores history, notes, reminders, tasks, and chat context locally.

## Quick start
1. Copy `.env.example` to `.env` and fill in values.
2. Run `npm install`.
3. Run `npm run start` to keep the scheduler running.

## Docker quick start
1. Copy `.env.example` to `.env` and fill in values.
2. Run `docker compose up -d --build`.
3. Check logs with `docker compose logs -f`.

Note: Docker runs two services:
- `schoology` (scheduler for scrape/send/reminders)
- `telegram-agent` (chat agent)

## Uptime and Updates (Docker)
For higher uptime and safer updates, use Docker with auto-restart and health checks.

Common commands:
- Start or update: `docker compose up -d --build`
- Check health: `docker compose ps`
- Tail logs: `docker compose logs -f`
- Stop: `docker compose down`

## Run modes
- `npm run scrape` scrapes and updates local state.
- `npm run send` sends the latest summary.
- `npm run run-once` scrapes and sends immediately.
- `npm run agent:telegram` starts the Telegram agent (chat).
- `npm run agent:cli -- "What is missing today?"` runs a local chat query.

## Data
- `data/state.json` stores assignment history and last run metadata.
- `data/storage.json` stores browser session state for faster logins.
- `data/agent.db` stores assignments, notes, reminders, tasks, and chat state.

## Debug
Set `DEBUG_DUMP=true` in `.env` to save a screenshot and HTML snapshot to `data/` on failures.

## Interactive Login (First Time)
If the login flow changes or is protected by Microsoft, run:
- `npm run login:interactive`
Complete the login in the browser window, then press Enter in the terminal.
This saves `data/storage.json`, which is reused for scheduled runs.
If you are running in Docker, run the login command on your host (not inside the container) so the browser can open.

## Login IdP
If your district uses Microsoft/SSO, set `SCHOLOGY_IDP="microsoft"` in `.env`.
Other options: `local`, `azuread`, `schoology`, `adfs`. Default is `auto`.
If SSO requires selecting a school, set `SCHOLOGY_SSO_SCHOOL` (default is `Baltimore County Public Schools`).

## Telegram
Required `.env` values for Telegram:
- `DELIVERY_CHANNEL="telegram"`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_IDS` (comma-separated list of chat IDs)

How to get chat IDs:
1. Create a bot with BotFather and copy the bot token.
2. Send a message to your bot in Telegram.
3. Run `npm run telegram:updates` and copy the `chat_id` value.

## Agent (GPT-5.2)
Run a Telegram-based agent that can answer questions, update statuses, add notes, schedule reminders, and manage tasks.

Required `.env` values:
- `OPENAI_API_KEY`
- `OPENAI_MODEL` (default `gpt-5.2`)

Optional:
- `AGENT_LOG_PATH="data/agent.log"` to write message logs to a file.
- `AGENT_DB_PATH="data/agent.db"` to override where agent data is stored.
- `GITHUB_REPO="yourname/schoology-bot"` and `GITHUB_TOKEN="..."` to allow the agent to open GitHub issues.
- `GITHUB_LABELS="bug,agent"` to apply default labels when opening issues.
- `DATA_DIR="data"` to override the base data folder (useful for beta).

Note: If you use a group chat, Telegram bot privacy must be disabled (BotFather -> /setprivacy) or you must mention the bot for it to receive messages.

Tips:
- Say "file a bug" to log an error.
- Say "log a feature request" to capture improvements or ideas.

## Telegram Agent Notes
- The agent runs as a single instance; a lock file prevents duplicate responses.
- Incoming messages are batched briefly (about 1 second) so fast sequences become one request.
- If a batch exceeds the limit, the oldest messages are dropped to keep the newest context.
- The agent shows a typing indicator and sends a "Working on it..." message after 8 seconds if needed.
- Bootstrap context files are loaded if present: `AGENTS.md`, `TOOLS.md`, `SOUL.md`, and any markdown files in `skills/`.

## Skills (Local)
Place short, ASCII-only markdown files in `skills/` to extend the agent with local skills.
These are loaded into the agent context on each run.

## Beta Telegram Stack
Use a separate bot for beta testing to avoid conflicts with prod.
1. Create `.env.beta` and set `DATA_DIR="data/beta"` plus a new Telegram bot token and chat id.
2. Run: `docker compose -f docker-compose.beta.yml --env-file .env.beta up -d --build`

## Tasks and Reminders
You can create personal tasks (not tied to Schoology) and get Telegram reminders.

Examples:
- "Remind me to ask a friend tonight at 9pm."
- "List my tasks for today."
- "Mark task 3 done."

Tasks roll over by 24 hours if they are not marked done.

Reminder delivery:
- The scheduler checks tasks every minute by default (`REMINDER_CRON`).
- The daily summary includes all tasks scheduled for today.
- If you change a reminder time, the agent will replace the existing pending reminder.
- To remove any legacy duplicates, run `npm run reminders:cleanup`.

## Manual Statuses (Explicit Set)
These are the default manual status codes the agent understands:
- `A` = `Excused (doesn't count)`
- `B` = `Practice / not for grade`
- `C` = `No way to fix it`
- `D` = `No grade put in yet`
- `E` = `Waiting on teacher`

The agent also accepts custom status text when you specify it explicitly.

By default, **Ignored** statuses (A/B/C) are hidden from the missing list unless you ask to show them.

## Tests (Offline)
Run unit and offline E2E tests without hitting Schoology:

```
npm test
```

What is covered:
- Offline grade parsing via HTML fixture.
- Manual status code mapping.
- Bulk and numbered status updates.
- Task reminder scheduling and rollover.
- Telegram formatting and batching.

## Twilio SMS
Required `.env` values for SMS:
- `DELIVERY_CHANNEL="twilio"`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_FROM` (or `TWILIO_MESSAGING_SERVICE_SID`)
- `TWILIO_TO` (comma-separated list of numbers, e.g. `+14155550123,+14155550124`)

Twilio setup checklist:
- Buy an SMS-capable Twilio number.
- If your account is in trial mode, verify each recipient number in the Twilio Console.
- Optional: create a Messaging Service and add your number (then set `TWILIO_MESSAGING_SERVICE_SID`).
- Optional: enable SMS permissions for the countries you will message.

For email delivery, set `DELIVERY_CHANNEL="email"` and the SMTP values.

## Roadmap
See `docs/ROADMAP.md`.

## Refreshing Schoology
If someone says "check again" or "I turned that in", the agent can run a fresh scrape and reconcile manual statuses.

Policy for manual statuses on resolved items:
- Auto-clear only A/B/C (ignored statuses) when the assignment is resolved and has no notes.
- Keep D/E (pending), any custom statuses, and anything with notes.
- The agent will summarize what it cleared and what it kept.
