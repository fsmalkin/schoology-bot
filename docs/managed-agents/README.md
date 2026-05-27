# Claude Managed Agents Migration

Decision date: 2026-05-25

## Tracking
- Project board: [FSM Engineering Board](https://github.com/users/fsmalkin/projects/3)
- Parent issue: [#25 Migrate Schoology runtime to Claude Managed Agents](https://github.com/fsmalkin/schoology-bot/issues/25)
- Completed foundation slice: [#27 Managed Agents session mapping and dev config](https://github.com/fsmalkin/schoology-bot/issues/27)
- Current active slice: [#30 Managed Agents parity story suite and judge gate](https://github.com/fsmalkin/schoology-bot/issues/30)
- Related repo docs: [Roadmap](../ROADMAP.md), [Backlog](../BACKLOG.md), [System](../SYSTEM.md), [Test Coverage](../TEST_COVERAGE.md)

Implementation slices:
1. [#27 Managed Agents session mapping and dev config](https://github.com/fsmalkin/schoology-bot/issues/27)
2. [#28 Managed Agents Telegram dev bridge](https://github.com/fsmalkin/schoology-bot/issues/28)
3. [#29 Managed Agents custom tool loop through Schoology tools](https://github.com/fsmalkin/schoology-bot/issues/29)
4. [#30 Managed Agents parity story suite and judge gate](https://github.com/fsmalkin/schoology-bot/issues/30)
5. [#31 Managed Agents health, event log, and idle cost controls](https://github.com/fsmalkin/schoology-bot/issues/31)
6. [#32 Managed Agents prod canary, rollback, and stabilization](https://github.com/fsmalkin/schoology-bot/issues/32)

## Decision
Claude Managed Agents is the new top-priority agent-runtime path for Schoology Bot.
OpenClaw is no longer a production promotion candidate because it has proven too
unstable and too much operational work to keep shaping.

Production stays on the current Docker runtime until the Managed Agents dev
runtime passes parity, observability, cost, and rollback gates.

## Target Architecture
1. Telegram receives a user message through the existing bot boundary.
2. The Managed Agents bridge maps Telegram chat IDs to Claude managed sessions.
3. The bridge appends the user event to the managed session and polls/streams the
   agent response.
4. Claude custom tool requests are executed by existing deterministic app code:
   `runToolByName` directly in-process for dev, or `schoology-tool-api` when a
   sidecar boundary is useful.
5. Tool results are sent back to the managed session.
6. Final assistant text is sent to Telegram through the existing sender.

Local scheduler/reminder delivery remains authoritative until we intentionally
prove that Managed Agents can own a specific scheduled flow more reliably and
with acceptable idle cost.

## Dev First
The first implementation target is a dev runtime, not prod replacement.

Acceptance criteria:
- Session bridge persists chat-to-session mapping.
- Custom tool loop supports all current Schoology tool flows.
- No duplicate Telegram replies.
- Clarification turns work for shorthand and partial inputs.
- Tool-call loops fail closed with friendly text.
- Event history is inspectable enough for debugging and judge artifacts.
- Idle sessions terminate or pause predictably. Tracked as the next
  health/cost-controls slice, not a blocker for dev Telegram UAT.
- Health dashboard can show bridge/session status. Tracked as the next
  health/cost-controls slice, not a blocker for dev Telegram UAT.
- Legacy prod Docker runtime can be restored without data loss.

## Dev Config
Tracked by [#27](https://github.com/fsmalkin/schoology-bot/issues/27).

Implemented foundation:
- `MANAGED_AGENTS_ENABLED`: opt-in switch; defaults off.
- `RUNTIME_STACK=managed-agents`: also selects the Managed Agents runtime.
- `MANAGED_AGENTS_ENV`: session environment key; defaults to dev/runtime stack.
- `ANTHROPIC_API_KEY` / `CLAUDE_API_KEY`: Claude API credential lookup.
- `CLAUDE_MANAGED_AGENT_ID`: target managed agent id.
- `CLAUDE_MANAGED_ENVIRONMENT_ID` / `MANAGED_AGENTS_ENVIRONMENT_ID`: target Claude environment id.
- `ANTHROPIC_BASE_URL`: defaults to `https://api.anthropic.com`.
- `CLAUDE_MANAGED_AGENTS_BETA`: defaults to `managed-agents-2026-04-01`.
- `MANAGED_AGENT_SESSION_TTL_MINUTES`: defaults to `1440`.
- `MANAGED_AGENT_IDLE_TIMEOUT_MINUTES`: defaults to `30`.
- `MANAGED_AGENT_STREAM_TIMEOUT_MS`: defaults to `120000`.
- `MANAGED_AGENT_MAX_TOOL_ROUNDS`: defaults to `8`.
- `MANAGED_AGENT_TOOL_RESULT_MAX_CHARS`: defaults to `20000`.
- `MANAGED_AGENT_SESSION_NAMESPACE`: optional namespace for separating dev/prod session mappings.

Persistent session mapping lives in SQLite table `managed_agent_sessions` and maps
`chat_id + environment` to the current Claude managed session id, status,
timestamps, expiry, and metadata.

## Dev Bridge
Tracked by [#28](https://github.com/fsmalkin/schoology-bot/issues/28) and
[#29](https://github.com/fsmalkin/schoology-bot/issues/29).

Implemented dev bridge foundation:
- `src/telegram_agent.js` now routes chat through `src/agent_runtime.js`.
- `src/agent_runtime.js` selects legacy OpenAI Responses or Managed Agents from config.
- `src/managed_agent_bridge.js` creates/reuses Claude sessions, sends
  `user.message` events, streams session events, collects `agent.message` text,
  and resolves `agent.custom_tool_use` events through local `runToolByName`.
- `src/managed_agent_client.js` is a thin REST/SSE client for Claude Managed
  Agents session creation, event send, event stream, and session retrieval.
- `src/managed_agent_tools.js` exports the Schoology custom tool definitions
  needed when configuring the managed agent.
- `src/managed_agent_definitions.js` defines the dev/prod Managed Agents agent
  and environment payloads.
- `scripts/managed_agents_admin.mjs` can render/create/update/retrieve/list
  agents and environments through the Claude API.
- Claude custom tool names use the API-valid `schoology_` prefix, for example
  `schoology_list_assignments`. The local bridge maps those names back to
  deterministic app tools such as `list_assignments`.
- The custom tool loop rejects unsupported custom tools with explicit tool
  result errors, denies non-custom tool confirmations by default, and bounds
  tool result payloads before sending them back to Claude.

Local/mock UAT coverage:
- `tests/managed_agent_bridge.test.js` verifies Telegram text -> session event
  -> assistant reply.
- `tests/managed_agent_bridge.test.js` verifies session reuse and a custom
  Schoology tool call returning local assignment data.
- `tests/managed_agent_bridge.test.js` also verifies unsupported tool errors,
  built-in tool denial, deterministic invalid-arg errors, bounded large result
  payloads, and tool-round limits.
- `tests/managed_agent_tools.test.js` verifies exported custom tool definitions
  cover the full Schoology tool surface.
- `scripts/run_agentic_story_suite.mjs` calls `runChatMessage`, so setting
  `RUNTIME_STACK=managed-agents` or `MANAGED_AGENTS_ENABLED=1` points the parity
  runner at the Managed Agents bridge instead of the legacy OpenAI runtime.

Live dev UAT status:
- Claude Managed Agents credentials and dev resource IDs are present in the
  ignored managed-dev env.
- The dev cloud agent was updated to version `2` on 2026-05-27 so its system
  prompt matches the legacy reminder-default policy.
- The parity story runner now uses an explicit story clock
  (`AGENTIC_STORY_NOW`, default `2026-05-27T12:00:00-04:00`) so natural-language
  dates like "tomorrow" do not drift across local/UTC midnight.
- Beta Telegram bot/chat credentials are present. The managed-dev env includes
  the beta thread id; `.env.beta` does not.

Current API-created resources:
- Dev environment: `env_01ED1rmcXotjKBkTPmqfpP4o`
- Dev agent: `agent_01JNsvgRBG7d6ubtr72PCFGF`
- Prod environment: `env_01WZsUiGGrKh72bpUEkGYtHp`
- Prod agent: `agent_01RZvAqM6cEgSJjQmhzHcns4`

Live dev API smoke completed:
- No-tool session returned `OK`.
- Custom-tool session called `list_assignments` and returned no missing
  assignments against an isolated empty-state DB.
- Legacy OpenAI story gate passed after the deterministic story-clock change:
  `artifacts/agentic-story-suite/20260527-023407`.
- Managed Agents story gate and judge passed against live Claude sessions:
  `artifacts/agentic-story-suite/20260527-022952`.
- Docker prod rebuild/health smoke passed:
  `docker compose -p schoology-prod up -d --build`,
  `curl.exe -s http://127.0.0.1:8787/api/health`, and service log tails.
- Live dashboard browser smoke passed with Playwright against
  `http://127.0.0.1:8787` with no console/page errors.
- Telegram beta-thread outbound smoke sent successfully through
  `.env.managed-dev` (message id `196`).
- Legacy beta/OpenClaw was stopped and beta Telegram was moved to the Managed
  Agents bridge. The first inbound beta-thread message was handled by the
  Managed Agents path and created an active `schoology-dev` Claude session
  (`sesn_01USppax1VA7hznML5paSh9C`). A follow-up inbound message is still
  useful to prove the current Dockerized managed-dev container instance after
  the foreground poller was replaced.
- A full scoped programmatic Managed Agents JTBD UAT passed against isolated
  state and live Claude session `sesn_01HpAfEZH9345jZQC5Fh9dbB`, covering
  seeded assignment listing, manual status update, assignment note, assignment
  reminder, standalone recurring task, task correction, unsupported monthly
  fallback, daily summary, and due-reminder drain.

## API Management
Tracked by [#30](https://github.com/fsmalkin/schoology-bot/issues/30).

Render the dev environment payload:

```powershell
npm run managed:render-env:dev
```

Render the dev agent payload:

```powershell
npm run managed:render-agent:dev
```

Create the dev environment after `ANTHROPIC_API_KEY` is set in `.env.managed-dev`:

```powershell
npm run managed:create-env:dev
```

Create the dev agent:

```powershell
npm run managed:create-agent:dev
```

The create commands print the IDs to copy into `.env.managed-dev`:

```env
CLAUDE_MANAGED_ENVIRONMENT_ID=...
CLAUDE_MANAGED_AGENT_ID=...
```

## Parity Stories
The Managed Agents dev runtime must pass the same user-facing stories before UAT:
1. Refresh Schoology and list actionable/pending/archived assignments.
2. Update manual status for a missing item.
3. Add notes and see them reflected in daily summary/context.
4. Create standalone and assignment-linked reminders.
5. Deliver due reminders without duplicates.
6. Generate the daily summary with manual statuses honored.
7. Handle login/session failure with a clear user alert.
8. Avoid tool-call loops and repeated clarification loops.

Current status:
- Reminder/recurrence parity story suite and judge passed for both legacy and
  Managed Agents runtimes.
- The broader Managed Agents JTBD UAT listed above covers items 2-6 plus
  assignment listing. Live scrape/refresh and login-failure alerting remain
  deterministic-test covered only in this slice; they should be included in a
  later live smoke before prod canary.

## Rollout Gates
1. Dev bridge implemented behind explicit env/config switches.
2. Copied prod memory/state loaded into dev runtime.
3. Unit and integration coverage added for session mapping and tool-loop routing.
4. Agentic story suite and judge artifacts produced for Managed Agents.
5. User UAT completed on dev.
6. Prod canary starts with a small prompt set and rollback command ready.
7. 24h stabilization confirms no duplicate replies, missed reminders, runaway
   session hours, or unexpected tool writes.

## OpenClaw Disposition
OpenClaw files, compose definitions, and scripts remain only for rollback or
reference until they are removed intentionally in a later cleanup issue.

Do not add new OpenClaw UAT, cron-bootstrap, or upstream-sync work unless the
user explicitly asks to revive that path.

## Reference Links
- Claude Managed Agents overview: https://platform.claude.com/docs/en/managed-agents/overview
- Claude Managed Agents tools: https://platform.claude.com/docs/en/managed-agents/tools
