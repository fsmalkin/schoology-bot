# Roadmap

## Goal
Run a reliable Schoology assistant that refreshes assignments, keeps actionable status clean, and delivers clear daily/reminder updates via Telegram. Keep deployment local-first and server-ready.

## Current Decisions
- Runtime model: GPT-5.2.
- Primary delivery channel: Telegram.
- Timezone default: America/New_York.
- Daily jobs: scrape 6:00 AM ET, summary 7:00 AM ET, reminders every minute.
- Assignment status model is fixed (A/B/C/D/E) with freeform notes.
- Actionable vs Pending vs Ignored/Archived presentation is the default UX.
- Prod runs existing app stack (`schoology` + `telegram-agent`) in Docker.
- Beta OpenClaw stack runs separately (`schoology-beta-openclaw`, `schoology-tool-api-beta`, `openclaw-gateway-beta`).
- OpenClaw beta workspace is Schoology-specific (no generic bootstrap identity flow).
- Beta helper scripts now use cross-shell env injection (`scripts/with_env.js`) instead of shell-specific `set ... &&`.

## Now (Stack Ranked)
1. Beta OpenClaw UAT on Telegram (tool flows + conversation quality + stability).
2. Re-auth reliability: ensure beta/prod login session refresh path is consistent and documented.
3. OpenClaw upstream sync policy: define cadence, validation gate, and promotion criteria.

## Next
1. Add lightweight context handoff summary per chat (reduce repeated clarification loops).
2. Implement skill-router roadmap item (load only relevant skills per request).
3. Add recurring reminder capability (or explicit non-support UX) with clear tool capability messaging.

## Later
- Long-term memory compaction/summarization policy for long chats.
- Cost telemetry message (daily spend + cumulative spend).
- Optional local web admin UI for assignments/notes/reminders.

## Operational SOP
- Auto-update remains manual unless scheduler is added.
- Update command: `scripts/auto_update.ps1 -Branch main`.
- After updates: rebuild Docker and run smoke checks before promotion.
