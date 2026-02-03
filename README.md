# Schoology Missing Assignments

Local automation that logs into Schoology, finds missing assignments, and sends a daily summary via Telegram, SMS (Twilio), or email.

## Quick start
1. Copy `.env.example` to `.env` and fill in values (Telegram, Twilio, or SMTP).
2. Run `npm install`.
3. Run `npm run start` to keep the scheduler running.

## Docker quick start
1. Copy `.env.example` to `.env` and fill in values (Telegram, Twilio, or SMTP).
2. Run `docker compose up -d --build`.
3. Check logs with `docker compose logs -f`.

## Run modes
- `npm run scrape` runs the scrape and updates local state.
- `npm run send` sends the summary using the latest scrape.
- `npm run run-once` scrapes and then sends a summary immediately.

## Data
- `data/state.json` stores assignment history and last run metadata.
- `data/storage.json` stores browser session state for faster logins.

## Debug
Set `DEBUG_DUMP=true` in `.env` to save a screenshot and HTML snapshot to `data/` on failures.

## Interactive Login (First Time)
If the login flow changes or is protected by Microsoft, run:
- `npm run login:interactive`
Complete the login in the browser window, then press Enter in the terminal.
This saves `data/storage.json`, which is reused for scheduled runs.

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
Optional: run a Telegram-based agent that can answer questions, update statuses, add notes, and schedule reminders.

Required `.env` values:
- `OPENAI_API_KEY`
- `OPENAI_MODEL` (default `gpt-5.2`)

Run modes:
- `npm run agent:telegram` starts the Telegram agent (long-running).
- `npm run agent:cli -- "What is missing today?"` runs a single local query.

Agent data:
- `data/agent.db` stores assignments, notes, reminders, and chat state.
- Optional: set `AGENT_LOG_PATH="data/agent.log"` to write message logs to a file.

Note: If you use a group chat, Telegram bot privacy must be disabled (BotFather -> /setprivacy) or you must mention the bot for it to receive messages.

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
