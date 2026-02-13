# OpenClaw Evaluation (beta branch)

This branch is used to evaluate OpenClaw as an alternate runtime while preserving
Schoology-specific behavior and data model.

## Current wiring
- Upstream OpenClaw source: `vendor/openclaw` (git submodule)
- Schoology OpenClaw workspace: `openclaw_workspace/`
- Beta compose stack: `docker-compose.beta-openclaw.yml`
  - `openclaw-gateway-beta`
  - `schoology-tool-api-beta`
  - `schoology-beta-openclaw`

## Workspace policy
- Schoology-only context files (`AGENTS.md`, `SOUL.md`, `USER.md`, `TOOLS.md`, `HEARTBEAT.md`).
- Skills:
  - `schoology-tools`
  - `bug-filing`
- Generic bootstrap/identity flows are removed for this workspace.

## Pull/update upstream OpenClaw
- Init submodules after clone:
  `git submodule update --init --recursive`
- Pull latest OpenClaw:
  `git submodule update --remote --merge vendor/openclaw`

## Evaluation focus
1. Refresh/list/update assignment workflows
2. Notes/reminders/task workflows
3. Bug/feature filing behavior
4. Telegram quality (formatting, duplication, stability)
5. Context continuity over multi-turn conversations

## Notes
- Production remains on `main` stack until explicit promotion.
- Keep beta token/session isolated from prod.
