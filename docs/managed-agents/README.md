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
7. [#34 Remove OpenClaw code and repo artifacts](https://github.com/fsmalkin/schoology-bot/issues/34)

## Decision
Claude Managed Agents is the new top-priority agent-runtime path for Schoology Bot.
OpenClaw is no longer a production promotion candidate because it has proven too
unstable and too much operational work to keep shaping. OpenClaw is now slated
for removal from code, compose files, scripts, tests, and active docs under
[#34](https://github.com/fsmalkin/schoology-bot/issues/34).

Production stays on the current Docker runtime until the Managed Agents dev
runtime passes parity, observability, cost, and rollback gates.
Rollback means rebuilding the current committed Docker prod runtime, not
starting OpenClaw.

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
- Current committed prod Docker runtime can be restored without data loss.
- OpenClaw artifacts are removed before prod canary unless a concrete
  current-runtime dependency is proven.

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
- `CLAUDE_MANAGED_MEMORY_STORE_ID` / `MANAGED_AGENT_MEMORY_STORE_ID`: optional Claude memory store id mounted into new managed sessions.
- `MANAGED_AGENT_MEMORY_STORE_ACCESS`: memory store access mode; defaults to `read_write`.
- `MANAGED_AGENT_MEMORY_STORE_INSTRUCTIONS`: optional per-resource memory instructions.
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
  Existing sessions are replaced when the local managed-agent definition
  revision changes, so prompt/toolset changes do not leave beta chats stuck on
  stale instructions.
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
- The managed agent enables only `web_search`, `web_fetch`, and the memory file
  tools `read`, `write`, `edit`, `glob`, and `grep` from Anthropic's agent
  toolset. The toolset default is disabled, and `bash` remains unavailable.
- When `CLAUDE_MANAGED_MEMORY_STORE_ID` is configured, new Claude sessions attach
  that store as a `memory_store` resource. The agent may consult or update files
  under `/mnt/memory`, but Schoology data remains authoritative in the local app
  DB/tools.
- Claude managed memory is not used as a raw transcript store. The local bridge
  stores only bounded last-failed-request retry context in `managed_agent_sessions`
  and expands retry shorthand such as `try again` across stream failures and
  forced session resets.
- A kid-safe content guard blocks unsafe Telegram input before any model/API
  call and replaces unsafe final assistant output before Telegram delivery.
- The custom tool loop rejects unsupported custom tools with explicit tool
  result errors, allows only safe web and memory file built-in confirmations,
  denies other non-custom tool confirmations, and bounds tool result payloads
  before sending them back to Claude.

Local/mock UAT coverage:
- `tests/managed_agent_bridge.test.js` verifies Telegram text -> session event
  -> assistant reply.
- `tests/managed_agent_bridge.test.js` verifies session reuse and a custom
  Schoology tool call returning local assignment data.
- `tests/managed_agent_bridge.test.js` also verifies unsupported tool errors,
  web and memory file built-in confirmation allow-listing, memory store resource
  attachment, unsupported built-in denial, kid-safe input/output blocking, stale
  definition revision replacement, local retry context after session reset,
  deterministic invalid-arg errors, bounded large result payloads, and tool-round
  limits.
- `tests/managed_agent_tools.test.js` verifies exported custom tool definitions
  cover the full Schoology tool surface.
- `tests/kid_safe_content_filter.test.js` verifies ordinary schoolwork and safe
  web lookup prompts pass while adult, violent, dangerous, cyber-abuse,
  harassment, and self-harm requests are blocked or redirected.
- `tests/managed_agent_definitions.test.js` verifies the memory prompt guardrails
  prohibit storing secrets, raw grades, full assignment lists, private student
  records, unsafe content, or verbatim fetched/web content in Claude memory.
- `scripts/run_agentic_story_suite.mjs` calls `runChatMessage`, so setting
  `RUNTIME_STACK=managed-agents` or `MANAGED_AGENTS_ENABLED=1` points the parity
  runner at the Managed Agents bridge instead of the legacy OpenAI runtime.

Live dev UAT status:
- Claude Managed Agents credentials and dev resource IDs are present in the
  ignored managed-dev env.
- The dev cloud agent was updated to version `3` on 2026-05-27 so its system
  prompt matches the legacy reminder-default policy and avoids Markdown tables
  in Telegram replies.
- The parity story runner now uses an explicit story clock
  (`AGENTIC_STORY_NOW`, default `2026-05-27T12:00:00-04:00`) so natural-language
  dates like "tomorrow" do not drift across local/UTC midnight.
- Beta Telegram bot/chat credentials are present. The managed-dev env includes
  the beta thread id; `.env.beta` does not.

Current API-created resources:
- Dev environment: `env_01ED1rmcXotjKBkTPmqfpP4o`
- Dev agent: `agent_01JNsvgRBG7d6ubtr72PCFGF`
- Dev memory store: `memstore_01F4pmYqg2GRep72inSfK2zi`
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
- Beta Schoology storage was confirmed stale, refreshed via interactive Chrome
  login, and verified from inside the Dockerized managed-dev container against
  `https://bcps.schoology.com/grades/grades` with no visible login controls.
- A live managed-dev repro after auth refresh passed with Claude session
  `sesn_018Gc6shAGPFyDd6DGXhLSw9`: `refresh_schoology` scraped real Schoology
  data successfully, then `list_assignments` returned zero actionable,
  pending, or ignored missing assignments. A duplicate action-id observation
  from the first repro was fixed in the bridge and covered by regression tests.
- Telegram formatting was hardened after beta UAT showed Markdown tables wrap
  poorly in chat. The sender now converts Markdown pipe tables to compact lists,
  and the dev cloud agent version `3` instructs Claude not to use tables. A live
  beta-thread formatting smoke sent message id `208`.
- Submitted/ungraded UAT gap was closed after beta UAT exposed a bad "no
  submitted-but-ungraded rows" answer. `list_assignments` now has a
  `submitted_awaiting_grade` filter, the dev cloud agent version `4` routes
  these questions to that filter, and story-gate `S9` covers the behavior.
  Legacy story gate passed at `artifacts/agentic-story-suite/20260527-051545`;
  Managed Agents story gate and judge passed at
  `artifacts/agentic-story-suite/20260527-052502`.
- Managed Agents bridge now drops speculative assistant text emitted before a
  required custom-tool result. This prevents Telegram replies from combining a
  pre-tool guess with the confirmed tool result; the regression is covered in
  `tests/managed_agent_bridge.test.js`.
- Web search/fetch and kid-safe guardrails are implemented in code and covered
  by local tests. The dev cloud agent was updated to version `5` on
  2026-05-28 with only `web_search`/`web_fetch` enabled from the built-in
  toolset. Live smokes passed for safe BCPS calendar web lookup
  (`sesn_01XemzqCm6qiasnsqKYScfvA`), unsafe input blocking with no Claude
  session created, and Schoology submitted/ungraded routing through
  `list_assignments` from the recreated Dockerized managed-dev poller
  (`sesn_01Uw4f9QtyPcvkTeKJxdPFCW`).
- Claude managed memory is implemented in code and covered by local tests. The
  dev cloud agent was updated to version `7` on 2026-05-28 with memory file
  tools enabled and `bash` still disabled. A live policy memory was seeded at
  `/operating_rules/schoology_bot_memory_policy.md`, the agent wrote
  `/preferences/parent_preferences.md`, and a fresh session recalled that Fred
  prefers concise replies during beta UAT (`sesn_015nNuouPRitk1mvHgPWLF7e`).
  After Docker rebuild/recreate, the managed-dev poller created
  `sesn_015dSmmxjCgtVVTei98gVkDF` with the memory store attached and recalled
  the same preference from inside the container.
- Date-filtered bulk status updates are implemented in code and covered by
  local/live copied-DB tests. The dev cloud agent was updated to version `8` on
  2026-05-28 with `bulk_update_assignments_by_filter` available for requests
  like "mark everything before 4/4 as no action needed." The deterministic tool
  defaults to missing assignments, includes pending local statuses, excludes
  ignored rows, uses a 200-row safety cap, maps "no action needed" to the local
  ignored status, and resolves school-year shorthand dates such as `4/4` to
  `2026-04-04` for the current 2025-26 school year. Live copied-DB repro
  `sesn_01Bj1VcoqpqDHWerrf8iTs88` updated the 7 intended beta rows in one
  tool call without timing out.
- Retry context across forced session resets is implemented locally in the
  bridge. On stream/tool-loop failures, the bridge stores only the bounded last
  failed request in `managed_agent_sessions`; a later `try again` expands to
  that request even after a session reset, without using Claude managed memory
  as a transcript store. Docker exec live smoke `sesn_012qVBQKzbosWvGy85XTWgRR`
  replied `retry context smoke OK` from a reset synthetic session and cleared
  the failed-request marker.

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

Create and inspect a Claude memory store:

```powershell
node scripts/managed_agents_admin.mjs create-memory-store "Schoology Bot Dev Memory" "Durable parent preferences and operating lessons; no secrets, raw grades, full assignment lists, or private student records."
node scripts/managed_agents_admin.mjs list-memory-stores
node scripts/managed_agents_admin.mjs retrieve-memory-store memstore_...
```

Seed and list memories:

```powershell
node scripts/managed_agents_admin.mjs create-memory memstore_... /operating_rules/schoology_bot_memory_policy.md "..."
node scripts/managed_agents_admin.mjs list-memories memstore_... /
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
9. Use web search/fetch only for school-safe public reference lookups, while
   keeping Schoology data routed through deterministic local tools.
10. Handle broad due-date status updates through deterministic filtered bulk
    tools instead of model-enumerated row-by-row updates.

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
OpenClaw files, compose definitions, scripts, tests, and active docs should be
removed under [#34](https://github.com/fsmalkin/schoology-bot/issues/34).

Do not add new OpenClaw UAT, cron-bootstrap, upstream-sync, or rollback work.
If a removal task finds a concrete dependency needed by the current prod Docker
runtime, document that dependency explicitly before preserving it.

## Reference Links
- Claude Managed Agents overview: https://platform.claude.com/docs/en/managed-agents/overview
- Claude Managed Agents tools: https://platform.claude.com/docs/en/managed-agents/tools
