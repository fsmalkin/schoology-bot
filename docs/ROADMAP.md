# Roadmap

## Goal
Build a local automation that logs into Schoology daily, finds missing assignments for Mayari, and sends a morning summary. Design it so it can be moved to a server later with minimal changes.

## Current Decisions
- Login uses Mayari username and password directly.
- MFA is not expected.
- Headless browser only.
- Credentials and config live in `.env`.
- Scrape runs at 6:00 AM ET, summary sent at 7:00 AM ET.
- Reminder scheduler runs every minute to deliver task reminders.
- Daily summary delivery via Telegram.
- Telegram agent runs as a single instance to avoid duplicate responses.
- Incoming Telegram messages are batched briefly and the oldest dropped if too long.
- Agent tool routing uses a multi-step structured-output planner (tool group -> tool picker -> augment).
- Tool execution is handled by app code (not model tool-calling).
- Availability target: run via Docker with restart policy + health check; update with `docker compose up -d --build`.
- Docker support included for easy server migration.
- If using Twilio later, use Auth Token for now; plan to switch to API Key for server move.
- Session-based login: use one-time interactive login locally; improve automated auth when moving to server.
- Add Telegram alert when re-authentication is required.
- Daily summary lists only unresolved items (Missing, Incomplete, Not completed/submitted, Absent).
- Agent model choice: GPT-5.2 (not mini or pro).
- Maintain offline unit + E2E tests using fixtures (no live Schoology needed).
- Daily summary includes tasks scheduled for today.
- Tasks roll over by 24 hours if not completed.
- Daily summary is DB-backed (manual statuses honored) and agentic for Telegram.
- Bug filing auto-generates a title when missing.
- Pending actions are stored per chat to complete multi-step confirmations.

## Now
1. Promote beta to production once UAT passes (bot behavior, formatting, reminders, refresh).
2. Add long-term memory + context compaction (summary-based) for agent chats.
3. Adopt a library-first approach for agent behavior (evaluate OpenAI Agents SDK, AgentSkills, LangGraph) before custom code.
4. Institutionalize retros: after each incident or learning point, update AGENTS/TOOLS/SOUL and roadmap with the fix.

## Next (Stack Ranked)
1. P2 - Triage empty bug report created by auto-filer and close/replace with real details (GitHub #5).
2. P2 - Improve tool capability awareness: expose tool constraints (ex: no recurring tasks yet) via MCP/skills or a tool-capabilities registry, and have the agent reference it before replying.

## Later
- Convert action-oriented notes into reminders when appropriate (ask user to confirm).
- Unified single Task model (Option B).
- Long-term memory summary stored in DB (per chat), injected into prompts.
- Context compaction triggers (turn count and/or token budget) with safe summaries.
- Library-first agent upgrades (prefer OpenAI Agents SDK or AgentSkills before custom code).
- Retros and instruction updates after incidents (AGENTS.md + core prompt changes).
- Phase 4 (Cost Monitoring): daily cost summary message.
- Phase 5 (Local Web UI): local admin UI for status/notes/reminders.

## Open Items
- Provide Telegram bot token and chat IDs.
- Optional: Provide Twilio credentials for SMS fallback.
- Optional: Provide SMTP credentials for email fallback.
- Decide when to switch to Twilio API Key credentials.
- Provide OpenAI API key for agent integration.
- Choose GPT model tier (gpt-5.2 vs gpt-5.2-pro vs gpt-5-mini).
- Decide whether to use Agents SDK or direct Responses API.
- Define compaction policy (trigger and summary scope).
- Choose a library-first agent baseline (Agents SDK vs AgentSkills vs LangGraph).
