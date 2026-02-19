# Roadmap

## Goal
Run a reliable Schoology assistant on the local server that refreshes assignments, keeps actionable status clean, and delivers clear daily/reminder updates via Telegram.

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
- Production runtime is hosted on the local server (Docker Compose).
- If using Twilio later, use Auth Token for now; plan to switch to API Key for server move.
- Session-based login: use one-time interactive login and refresh when session expires.
- Add Telegram alert when re-authentication is required.
- Daily summary lists only unresolved items (Missing, Incomplete, Not completed/submitted, Absent).
- Agent model choice: GPT-5.2 (not mini or pro).
- Maintain offline unit + E2E tests using fixtures (no live Schoology needed).
- Daily summary includes tasks scheduled for today.
- Tasks roll over by 24 hours if not completed.
- Daily summary is DB-backed (manual statuses honored) and agentic for Telegram.
- Local health dashboard is available at `http://127.0.0.1:8787` for service/data checks.
- Bug filing auto-generates a title when missing.
- Pending actions are stored per chat to complete multi-step confirmations.
- Bug filing uses a draft+validate+submit skill (no empty issues).
- Schoology "submitted but not graded" indicators are auto-archived (Ignored) in summaries/lists by default.
- OpenClaw beta runtime uses gateway-native Telegram + cron, with `schoology-tool-api` retained as a parity sidecar.
- Unattended login supports secret-file credentials and storage-state bootstrap (plain/encrypted blobs).
- Reminder runtime auto-cancels inactive assignment-linked reminders before scrape/reminder dispatch.
- Long-thread continuity uses DB-backed compaction memory when enabled.

## Status Snapshot (2026-02-18)
- Delivered:
  - Runtime migrated from laptop to local server and is running in Docker Compose with health checks.
  - OpenClaw beta one-gateway runtime is running from one shared image (`schoology-beta-openclaw-unified:latest`).
  - Docker image sprawl reduced by consolidating gateway/tool-api/cron/monitor/dashboard onto one image build.
  - Login failure messaging now respects configured `SCHOLOGY_IDP` and avoids unnecessary provider-selection prompts.
- In progress:
  - Wave 1 UAT blockers for OpenClaw promotion:
    - #10 Auto-cancel reminders for inactive/resolved assignments.
    - #14 DB-backed compaction memory + long-thread continuity.
    - #15 Detail-page fallback for ambiguous submission status.
    - #18 Secret/session-based unattended login.
  - Production rollout checklist and cutover validation for OpenClaw runtime.

## Active Queue (P1)
1. OpenClaw beta UAT and production promotion readiness.
2. Auto-cancel assignment reminders when assignment becomes inactive/resolved (#10).
3. DB-backed context compaction and long-thread memory (#14).
4. Detail-page fallback for ambiguous submission status (#15).
5. Automate Schoology login via secrets for unattended runs (#18).

## OpenClaw Promotion Gates
1. Wave 1 automated tests pass (`npm test`).
2. OpenClaw beta runtime smoke checks pass (`openclaw-cron-sync`, `openclaw-gateway`, `schoology-tool-api`).
3. UAT checklist in `docs/openclaw/UAT_PROMOTION.md` passes all critical items.
4. No open P1 regression issues after Wave 1 verification.
5. Production cutover + rollback steps are documented and validated.

## Ready Next (P2)
1. #16 Plain-language mode for recaps/reminders (post-UAT).
2. #17 Assignment status: "Will complete in class" (post-UAT).
3. OpenClaw upstream sync SOP (what to pull, how to validate, when to promote).
4. Scheduled auto-update task decision (Windows Task Scheduler).

## Later (P3)
1. Convert action-oriented notes into reminders with user confirmation.
2. Unified single Task model (Option B).
3. Daily cost summary.
4. Local admin UI for status/notes/reminders.

## Tracking
- Backlog source of truth: `docs/BACKLOG.md`.
- Completed work log: `docs/COMPLETED.md`.

## Branch Governance
- `main` is the canonical planning source of truth (`docs/ROADMAP.md` + `docs/BACKLOG.md`).
- Feature branches may carry temporary planning edits during execution, but must reconcile to `main` before promotion.
- Beta/OpenClaw branch notes that are branch-specific should live under `docs/openclaw/`.
