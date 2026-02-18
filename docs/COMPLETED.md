# Completed Work

This document records completed milestones and major capability deliveries.

## Core Delivery
- Runtime migrated from laptop to local server (Docker Compose with persistent data/health checks).
- Local Schoology scrape and daily summary flow (6:00 AM ET scrape, 7:00 AM ET summary).
- Telegram delivery and agentic chat for summaries and updates.
- Persistent storage for assignments, notes, manual statuses, reminders, tasks, and chat state.

## Reliability and UX
- DB-backed daily summary (manual statuses honored).
- Agentic Telegram summary and on-demand summary commands.
- Pending-action handoff for confirmations (multi-turn updates).
- Bug filing auto-title + pre-submit validation to prevent blank-title failures.
- Notes included in daily summary.
- Reminders/tasks included in daily summary (Today/Upcoming/Overdue for Telegram).
- "Reminders" as the user-facing term for tasks/reminders.
- Resilient tool routing with group classification and fallback tool selection.
- Telegram formatting sanitizer (HTML + plain fallback) to avoid raw tags/entities.
- "Working on it" message cleanup after replies.
- Output normalization to ASCII for consistent Telegram rendering.
- Response drafting uses tool results when updates occur.
- Bootstrap context loader (AGENTS/TOOLS/SOUL/skills) to mirror Clawdbot-style workspace context.
- Auto-ignore prior-quarter/practice items (configurable keywords and age cutoff).
- Auto-plan reminders for upcoming assignments (configurable window and reminder time).
- Refresh responses now summarize Actionable/Pending/Archived instead of raw missing counts.
- Submission-aware ignore detection: Schoology "submitted but not graded" indicators now classify as Archived/Ignored by default (hidden from Actionable/Pending).
- Refresh messaging now explicitly reports how many submitted-but-ungraded items were archived.
- Optional auto-update script for pulling a branch and rebuilding Docker.
- Optional CI workflow for offline tests on PRs/pushes to main.
- Tool capability awareness documented (capabilities/limits in TOOLS.md and prompt).
- Capability registry + guardrails implemented in planner and runtime gate (Issue #13).

## Beta Program
- Beta bot branch and separate env/data dir (`.env.beta`, `DATA_DIR=data/beta`).
- Beta Docker Compose stack for safe testing.
- OpenClaw beta one-gateway stack consolidated to one shared image (`schoology-beta-openclaw-unified:latest`).
- OpenClaw beta project naming standardized to `openclaw-beta` for stable compose operations.
- Login failure messaging now respects configured `SCHOLOGY_IDP` to avoid repeated provider-selection prompts.
- Promotion workflow from beta to production (merge + rebuild prod, stop beta).

## Tests
- Offline unit and E2E tests using fixtures (no live Schoology dependency).
- Reminder CRUD and rollover tests.
- Local health dashboard service (UI + `/api/health`) with scheduler/agent heartbeat integration.

## Known Closed Issues (GitHub)
- #1 Agent fails on multi-line status message (OpenAI 500) - Closed.
- #2 Cannot delete/update existing scheduled reminders (only create new ones) - Closed.
