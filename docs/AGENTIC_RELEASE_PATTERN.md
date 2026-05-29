# Agentic Release Pattern

Purpose: standardize how we ship behavior-heavy agent features with reproducible evidence before user UAT.

## Pattern Scope
- Applies to releases where agent reasoning, tool routing, or write behavior changed.
- Required for reminder-impacting releases.

## Mandatory Flow
1. Prepare an isolated Managed Agents dev data/session state.
2. Run agentic story suite (chat-only flows).
3. Run one GPT-5.2 judge pass on story artifacts.
4. Review judge evidence.
5. Run user UAT.
6. Promote to production and monitor a stabilization window.

## Required Artifacts
- Dev data/session prep notes:
  - issue/worklog handoff with data source, session IDs, and cleanup notes
- Story suite artifacts:
  - `artifacts/agentic-story-suite/<timestamp>/story-suite-manifest.json`
  - `artifacts/agentic-story-suite/<timestamp>/stories/*/transcript.md`
  - `artifacts/agentic-story-suite/<timestamp>/stories/*/story.json`
- Judge artifact:
  - `artifacts/agentic-story-suite/<timestamp>/judge-result.json`

## Commands
- Story suite:
  - `npm run stories:run`
- Judge:
  - `npm run stories:judge`
- Combined gate:
  - `npm run stories:gate`

## Gate Policy
- Judge model: `gpt-5.2`.
- Judge run count: exactly one pass per release gate.
- Judge input must include story rubric, transcripts, and tool snapshot evidence.
- Release gate fails if any required story fails.

## Reuse In Other Projects
1. Keep the same six-step flow and artifact structure.
2. Replace story definitions with project-specific highest-risk user journeys.
3. Keep the judge schema strict JSON with per-story verdict + evidence snippets.
4. Treat isolated dev data/session prep as a hard precondition for UAT.

## Decision + Outcome
- Decision (2026-02-22): adopt isolated dev data prep + story-suite + single-pass GPT-5.2 judge as mandatory pre-UAT gate for reminder-scope changes.
- Outcome: recurring reminder release now has reproducible evidence artifacts and a reusable pattern for other projects.
