# Test Coverage and Gaps

This document summarizes current test coverage and the known gaps.

## Coverage summary

Unit tests
- DB schema migrations and CRUD for tasks/reminders/notes.
- Status normalization and auto-ignore rules.
- Summary builder (actionable vs pending).
- Time parsing and timezone formatting (local labels, shorthand).
- Reminder rollovers.
- Bug filing guardrails (no empty body).
- Telegram formatting sanitization.
- Capability registry rendering and runtime limits.
- Capability guard behavior (unsupported request blocked with fallback; supported request proceeds to tools).

Integration tests
- OpenAI live plan tests (tool planning and schema format).
- Live API simulation using dummy data.
- Reminder delivery flow (runReminders with mocked Telegram sender).

Smoke tests
- Docker smoke script: `scripts/smoke_docker.ps1` for build + health check.

CLI checks
- Manual CLI runs via `npm run agent:cli -- "..."` for basic flows.

## Gaps and risks

Schoology scraping (live)
- No automated live Schoology login/scrape tests.
- Playwright flow can regress if Schoology UI changes.

Telegram end-to-end
- No automated E2E tests for Telegram receive -> tool -> send.
- Manual UAT required after changes to agent or formatting.

Reminder delivery timing
- Automated test covers delivery + rollover with a fixed clock.
- Cron scheduling is not validated under real clock drift.

Bug filing to GitHub
- No automated integration test for GitHub issue creation (avoids live API calls).
- Relies on unit guards + manual verification.

OpenClaw stack
- No automated tests for OpenClaw gateway UI.
- Tool API health is checked via docker smoke only.

Performance and reliability
- No load or soak tests.
- Network failure handling not stress tested.

## Near-term additions (recommended)
- Add a Telegram E2E test harness that runs against a test bot and test chat.
- Add a reminder delivery integration test using a fake clock.
- Add a live scrape smoke test behind a feature flag.
