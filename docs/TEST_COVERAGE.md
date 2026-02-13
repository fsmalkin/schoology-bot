# Test Coverage

## Automated Coverage

### Unit tests
- Date/time parsing and normalization
- Status normalization and assignment summary bucketing
- Reminder/task CRUD + rollover
- Telegram formatting and repetition controls
- DB migrations

### Integration tests
- Tool runner paths (assignment updates, notes, reminders, tasks)
- Agent planning/routing with mocked and live API checks
- Bug/feature filing flow validation

### Live/API tests (in `npm test`)
- JSON-schema planning responses
- Tool routing checks for common intents
- Live simulation log generation

### Docker/Smoke coverage
- Compose startup health checks
- OpenClaw gateway channel status checks
- CLI smoke flows against beta OpenClaw runtime

## Current Gaps
1. End-to-end Schoology scrape with live login in CI (requires interactive auth/session).
2. Telegram end-to-end reply assertion in CI (depends on external bot/chat state).
3. Automated verification of daily cron schedule timing across DST boundaries.
4. Regression suite for long multi-turn conversation continuity in OpenClaw channel mode.

## SOP for New Functionality
- Add unit tests for core logic and edge cases.
- Add integration tests for tool/agent routing changes.
- Add CLI tests when user-facing CLI/scripts are changed.
- Add Docker smoke checks when runtime wiring changes.
- Update this file with coverage additions and any remaining gaps.
