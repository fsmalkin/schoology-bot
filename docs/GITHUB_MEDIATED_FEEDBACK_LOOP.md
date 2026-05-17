# GitHub-Mediated Feedback Loop Spike

## Decision
Use a GitHub-mediated feedback loop as the first implementation accelerator spike.

This is the selected first path because it uses capabilities already available in the current workflow: the assistant can update the repository and PR, while the local development environment can inspect the same branch and return validation results through GitHub.

Claude App, OpenClaw gateway, MCP-style bridge, and managed-agent options remain comparators, but they should not block this narrower proof.

## Goal
Prove that planning and implementation can move faster when validation results from the local development environment are returned to the assistant in an auditable, structured way.

The spike is validation-only. It does not change production Schoology behavior.

## Initial Scope
The first pass should support only safe development validation, such as:

- Test-suite result summaries.
- Story-suite result summaries.
- Static repo/status checks.
- Dashboard or service health snapshots from a non-production context.
- Human-approved diagnostic summaries.

## Explicit Non-Goals
- No production Schoology actions.
- No credential or session handling changes.
- No automatic production deployment.
- No replacement of Telegram, dashboard, Docker runtime, or current local/server state ownership.
- No broad autonomous execution.

## Proposed Workflow
1. Assistant updates the implementation branch with a requested validation checkpoint or PR comment.
2. User or local helper runs the approved validation locally.
3. The result is posted back to the PR, issue, or repo as a structured summary.
4. Assistant reads the result and continues the implementation loop.
5. If this reduces manual handoff, automate the local side in a later phase.

## First Proof Target
The first proof should answer:

- Can the assistant request a validation checkpoint from the PR context?
- Can the local side return a compact pass/fail summary without manual reformatting?
- Can the assistant use that result to decide the next implementation step?
- Is the loop meaningfully faster than ad hoc manual copy/paste?

## Safety Model
- Validation-only first.
- Human approval before any production-impacting or credential/session-sensitive action.
- Keep request/result records in GitHub so the loop is auditable.
- Keep results compact and redact sensitive values.
- Keep production Schoology runtime isolated unless a separate promotion decision is made.

## Acceptance Criteria
- A PR or issue-based validation request format is documented.
- At least one validation result is returned through GitHub.
- The assistant can read and act on the result.
- The decision memo is updated if the accelerator changes the preferred runtime path.

## Recommended First Manual Trial
Use PR #26 as the first trial.

Assistant requests a validation checkpoint in the PR.
User/local environment runs the approved validation.
User/local environment posts a compact result back to PR #26.
Assistant reads the PR result and updates the plan or implementation branch accordingly.
