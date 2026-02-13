# System Reference

## Services
Production (`docker-compose.yml`):
- `schoology`: scheduler/scraper/sender
- `telegram-agent`: native Telegram agent

Beta OpenClaw (`docker-compose.beta-openclaw.yml`):
- `schoology-beta-openclaw`: scheduler/scraper/sender (beta data paths)
- `schoology-tool-api-beta`: tool API bridge for OpenClaw
- `openclaw-gateway-beta`: OpenClaw runtime and Telegram channel

## Primary Paths
- Prod data: `data/`
- Beta data: `data/beta/`
- OpenClaw workspace: `openclaw_workspace/`

## Operational Commands
- Prod rebuild/restart: `docker compose up -d --build`
- Beta OpenClaw rebuild/restart:
  `docker compose -f docker-compose.beta-openclaw.yml --env-file .env.beta up -d --build`
- Prod agent logs: `docker compose logs --tail 200 telegram-agent`
- Prod scheduler logs: `docker compose logs --tail 200 schoology`
- Beta gateway logs:
  `docker compose -f docker-compose.beta-openclaw.yml --env-file .env.beta logs --tail 200 openclaw-gateway-beta`

## Login Session
- Interactive login writes Playwright storage JSON.
- Prod: `npm run login:interactive`
- Beta: `npm run login:interactive:beta`

## Safety
- Never print secret values from env.
- Keep beta and prod bot tokens isolated.
- Run one polling consumer per bot token.
