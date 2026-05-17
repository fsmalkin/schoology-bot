# Implementation Accelerator Spike

## Purpose
Evaluate whether the development loop can be accelerated by giving the planning assistant a safe way to request local validation work and receive structured results back, without changing production Schoology behavior.

This spike is intentionally narrow. It is not a production runtime migration and it is not a replacement for the Schoology assistant. It is a way to test whether repo planning, code changes, local validation, and result review can happen with less manual handoff.

## Baseline Assumption
The current production runtime remains the rollback target:

- Docker-based Schoology scheduler and Telegram agent.
- Local/server state in the existing data directory.
- Deterministic app-executed tool actions.
- Dashboard health visibility.
- Existing beta and story-gate validation patterns.

## Spike Hypothesis
If a bounded feedback loop can safely return local validation results to the planning assistant, then the GPT app / ChatGPT + GitHub path may remain the fastest near-term implementation path while Claude App and managed-agent options remain comparators.

## Candidate Feedback Paths

### 1. GitHub-Mediated Feedback Path
Use GitHub as the shared audit trail for validation requests and results.

Why evaluate first:
- The assistant can already update and inspect GitHub.
- The repo branch provides natural scoping.
- Requests and results are reviewable and recoverable.
- It avoids exposing the production runtime directly.

Expected first use:
- Validation-only development checks.
- No production Schoology action.
- No credential/session handling.

### 2. OpenClaw Gateway Path
Reuse lessons from the OpenClaw beta gateway and Schoology tool API split.

Why evaluate:
- It already exists in this repo as a beta architecture direction.
- It may provide a reusable gateway/channel model.

Concern:
- It may be more platform migration than minimal accelerator.

### 3. MCP-Style Bridge
Expose a narrow capability surface through an MCP-style boundary if a reliable host/client access path exists.

Why evaluate:
- Clean tool boundary.
- Potentially compatible with more than one agent shell.

Concern:
- It may require more setup before proving the basic feedback-loop value.

### 4. Managed-Agent Alternative
Compare whether a managed agent environment can provide the same acceleration without a local feedback bridge.

Why evaluate:
- It may support long-running implementation or validation tasks.

Concern:
- It may not share the same local environment, browser state, data, or Docker runtime.

## Scope for First Pass
The first pass should prove only the following:

1. A validation request can be created in an auditable place.
2. The local/dev side can process the request under a narrow policy.
3. The result can be returned in a structured format.
4. The assistant can inspect the result and continue planning or implementation.
5. The workflow is faster or clearer than manual handoff.

## Out of Scope for First Pass
- Production Schoology writes.
- Credential or session handling changes.
- Replacing Telegram.
- Replacing the dashboard.
- Replacing Docker production runtime.
- Broad autonomous execution.

## Safety Requirements
- Start validation-only.
- Require explicit user approval for anything production-impacting.
- Keep request and result history auditable.
- Keep outputs bounded and redact sensitive values.
- Keep the production Schoology stack isolated from the accelerator until a separate promotion decision is made.
- Preserve human review before any runtime migration.

## Proposed First Milestone
Create a minimal proof that can answer:

- Can this assistant request a local validation check through the chosen relay?
- Can the local environment return a clear pass/fail result?
- Can the result be reviewed from this chat without manual copy/paste?
- Did the loop save enough time to justify continuing?

## Success Criteria
- A documented feedback path is selected for the first implementation attempt.
- A validation-only loop is proven or rejected.
- The result is captured in the repo or PR discussion.
- The agent runtime decision memo is updated if the accelerator changes the preferred path.

## Decision Impact
If the feedback loop works well, prefer the GPT app / ChatGPT + GitHub path for near-term implementation while preserving the current production runtime.

If the feedback loop is too slow or brittle, compare Claude App and managed-agent paths more aggressively as implementation accelerators rather than only as production runtime alternatives.
