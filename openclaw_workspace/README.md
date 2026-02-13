# OpenClaw Workspace (beta)

This workspace is mounted into the OpenClaw gateway container for beta evaluation.

Contents:
- Skills: `openclaw_workspace/skills/*`
- Tool helper: `openclaw_workspace/tools/schoology_api.js`
- Pinned gateway config: `openclaw_workspace/openclaw.beta.json5`
- Core persona/context docs: `AGENTS.md`, `SOUL.md`, `USER.md`, `TOOLS.md`, `HEARTBEAT.md`

This workspace is intentionally Schoology-scoped so it does not share context with
other OpenClaw agents (for example Chasebot).
