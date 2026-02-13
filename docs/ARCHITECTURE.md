# Architecture

## Overview
The repo currently supports two runtime paths:
1. **Production stack**: native scheduler + Telegram agent.
2. **Beta OpenClaw stack**: OpenClaw gateway over the same Schoology data/tools.

Both paths share the same Schoology scraper, SQLite schema, and tool runner.

## Core Components
- `schoology` / `schoology-beta-openclaw`
  - Runs scheduler jobs (scrape, daily summary, reminder delivery).
- `telegram-agent` (prod)
  - Native Telegram bot agent (`src/telegram_agent.js`).
- `schoology-tool-api-beta`
  - HTTP bridge exposing internal tools at `/tools/run` for OpenClaw.
- `openclaw-gateway-beta`
  - OpenClaw message runtime using `openclaw_workspace/openclaw.beta.json5`.

## Data and State
- SQLite: `data/agent.db` (prod) and `data/beta/agent.db` or mounted DB volume in beta stack.
- Scrape state: `data/state.json` (prod), `data/beta/state.json` (beta).
- Playwright session: `data/storage.json` (prod), `data/beta/storage.json` (beta).
- Bug log fallback: `data/bugs.log` (prod), `data/beta/bugs.log` (beta).

## OpenClaw Beta Workspace
Path: `openclaw_workspace/`

Key files:
- `AGENTS.md`, `SOUL.md`, `USER.md`, `TOOLS.md`, `HEARTBEAT.md` (Schoology-specific context)
- `skills/schoology/SKILL.md`
- `skills/bug-filing/SKILL.md`
- `tools/schoology_api.js`

Design intent:
- Schoology-only behavior
- No generic bootstrap/onboarding flow
- No context sharing with other OpenClaw agents

## Tool Flow
1. User message arrives (Telegram/OpenClaw).
2. Agent decides action.
3. Skill executes `node .../schoology_api.js '{"tool":...,"args":...}'`.
4. Tool API calls `runToolByName` in app code.
5. Response is formatted for Telegram/plain text.

## Deployment
- Prod: `docker compose up -d --build`
- OpenClaw beta: `docker compose -f docker-compose.beta-openclaw.yml --env-file .env.beta up -d --build`

## Beta CLI Helpers
Cross-shell env runner:
- `node scripts/with_env.js .env.beta <command...>`

Used by:
- `npm run login:interactive:beta`
- `npm run telegram:updates:beta`

## Reliability Notes
- Keep only one consumer per bot token.
- Use health checks + restart policies.
- Treat login/session expiry as operational state; re-auth updates storage JSON.
