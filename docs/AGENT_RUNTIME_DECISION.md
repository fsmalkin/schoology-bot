# Agent Runtime Decision Memo

## Objective
Choose the next user-facing agent shell/runtime path for the Schoology assistant while preserving the core product functions that already work.

The decision is not only about model quality. It is also about which path gives the fastest safe development loop, the least runtime burden, the clearest operational model, and the lowest risk of weakening Schoology-specific behavior.

## Core Functions That Must Not Regress
Any selected path must preserve these functions:

- Schoology refresh/scrape and login/session handling.
- Assignment normalization and stable identity.
- Manual statuses, notes, reminders/tasks, and pending confirmations.
- Daily summaries and reminder delivery.
- Dashboard health/status visibility.
- Deterministic app-executed tool actions.
- Local/server state ownership unless explicitly migrated.
- Clear failure alerts when login, scrape, delivery, or runtime health breaks.

## Current Architecture Baseline
Current production remains a local/server Docker runtime with:

- Schoology scraper/scheduler.
- SQLite-backed assignment/task/reminder/chat state.
- Telegram delivery and chat agent.
- Dashboard.
- Deterministic tool runner.
- Offline test and story-gate coverage.

The existing OpenClaw beta path is a useful comparator because it already separates a gateway/channel layer from the Schoology tool API. It should not be promoted by inertia; it should be compared against the other runtime options.

## Options Compared

### Option A: Claude App Path
Use Claude-oriented interfaces for the user-facing or developer-facing shell, potentially through Claude Code, MCP, or a Claude-compatible tool bridge.

Strengths:
- Strong fit for codebase work and iterative development.
- Good comparator for local-tool and MCP-oriented workflows.
- Could pair well with a deterministic Schoology tool boundary.

Risks:
- May bias the product toward a developer assistant rather than a parent-facing Schoology assistant.
- Production scheduling, reminders, and dashboard state still need the existing local/server runtime or an equivalent service.
- Direct replacement of the Telegram/dashboard experience may be awkward unless the bridge is clean.

Best use:
- Developer acceleration and runtime comparison.
- Possible user shell only if the Schoology tool boundary remains deterministic and parity is proven.

### Option B: GPT App Path
Continue centering the workflow around ChatGPT/GitHub as the planning and implementation surface, with the Schoology runtime preserved and a provider/runtime abstraction added where needed.

Strengths:
- This chat already has GitHub visibility and can update the repo directly.
- Strong fit for product planning plus implementation tracking.
- If paired with a safe development feedback loop, this may become the fastest iteration path.
- Least disruptive to current Schoology runtime if implemented as an outer workflow rather than a rewrite.

Risks:
- Local validation still needs a bridge or user-mediated loop.
- A GPT-native app surface may not replace Telegram delivery/reminders without extra product work.
- Could create confusion if ChatGPT is used for development orchestration while the production assistant remains Telegram-based.

Best use:
- Near-term implementation path.
- Planning, repo updates, decision records, and supervised development loop.
- Production runtime can remain local/server + Telegram until a replacement proves parity.

### Option C: Managed Agent Path
Move some portion of the assistant into a managed agent environment that can run longer-lived tasks, call tools, and reduce local orchestration burden.

Strengths:
- Could reduce custom runtime burden if scheduling, execution, and tool access are reliable.
- Potentially useful for long-running evaluation, maintenance, or repo automation.
- May simplify some agent supervision workflows.

Risks:
- Schoology credential/session handling is sensitive and currently local/server-bound.
- Managed runtimes may weaken control over local state, dashboard integration, and live browser session reuse.
- Scheduled summaries/reminders and production-grade failure handling still require careful parity validation.
- Migration cost may be high relative to the near-term benefit.

Best use:
- Later-stage comparator or auxiliary worker path.
- Not the default production migration target until local state, credentials, scheduling, and parity are solved.

## Implementation Accelerator Options
Implementation acceleration is a first-class decision factor. A faster feedback loop may matter more than moving production runtime.

### Candidate 1: GitHub-Mediated Feedback Loop
Use GitHub as the auditable relay between this planning/implementation chat and the dev environment.

Strengths:
- Already available in this chat.
- Auditable, branch-scoped, and recoverable.
- Keeps production runtime untouched.
- Can start as validation-only.

Risks:
- Slower than a direct live bridge.
- Requires a local helper process or user-mediated step.
- Needs strict approval and output controls.

Best use:
- First accelerator spike.

### Candidate 2: OpenClaw Gateway
Use the existing OpenClaw beta direction as the channel/tool gateway for development feedback and possibly user runtime.

Strengths:
- Already represented in the repo.
- Aligned with gateway/channel separation.
- Could support a broader personal-assistant architecture.

Risks:
- More moving parts than a narrow feedback loop.
- May become a platform migration instead of a targeted accelerator.
- Needs renewed parity validation before promotion.

Best use:
- Comparator and possible medium-term gateway path.

### Candidate 3: MCP-Style Bridge
Expose a narrow set of Schoology/dev capabilities through an MCP-style boundary.

Strengths:
- Clean tool boundary.
- Compatible with multiple agent shells over time.
- Helps avoid coupling the core to any one provider.

Risks:
- Access path from this chat may not be available without an intermediate host or connector.
- Security model must be explicit.
- Could be overbuilt for the first spike.

Best use:
- Medium-term abstraction after the first feedback-loop spike proves value.

### Candidate 4: Managed-Agent Alternative
Use a managed agent environment for validation and implementation support instead of building a local feedback bridge.

Strengths:
- Could provide built-in long-running execution and stateful sessions.
- May reduce local helper complexity.

Risks:
- Might not see the same local runtime, credentials, browser state, or Docker environment.
- May move too much of the workflow away from the working local/server setup.

Best use:
- Comparator against the GitHub-mediated feedback loop.

## Recommendation
Recommended next path:

1. Preserve the current Schoology production runtime.
2. Continue on the GPT app / ChatGPT + GitHub path for planning and implementation.
3. Add a small, safe implementation-accelerator spike centered on an auditable feedback loop.
4. Treat Claude App and managed agent as comparators, not immediate production targets.
5. Do not promote OpenClaw beta or replace Telegram until parity is proven against the core functions.

Rationale:

- The current Schoology product value is in deterministic workflow execution, not the chat shell itself.
- A safe feedback loop from this planning chat to local validation could materially accelerate development without moving production runtime.
- Managed agents may be useful later, but they introduce platform coupling before the key parity questions are settled.
- Claude-oriented tooling remains valuable as a benchmark and possible developer accelerator, but it should not drive a production rewrite by default.

## Migration Plan

### Phase 1: Decision and Boundary Clarification
- Keep this memo as the decision record for the branch.
- Confirm the core function parity checklist.
- Identify the minimum provider/runtime abstraction needed without rewriting the Schoology core.
- Decide whether the first accelerator spike uses GitHub relay, OpenClaw gateway, MCP-style bridge, or managed-agent alternative.

### Phase 2: Implementation Accelerator Spike
- Start with a validation-only loop.
- Keep production Schoology actions gated behind explicit approval.
- Store requests/results in an auditable location.
- Redact and bound returned output.
- Compare speed and reliability against the current user-mediated flow.

### Phase 3: Provider/Runtime Abstraction
- Keep tool execution inside app code.
- Add or clarify model-provider boundaries only where needed.
- Preserve Telegram and dashboard behavior until a replacement has parity.

### Phase 4: Runtime Choice Follow-Through
- If GPT path wins, continue local/server production and use the feedback loop for development acceleration.
- If Claude path wins, connect Claude tooling through the same deterministic tool boundary.
- If managed agent wins, migrate only after a production parity and rollback plan exists.

## Parity Checklist
Before promoting any runtime or shell replacement, verify:

- Refresh Schoology.
- Build daily summary.
- Deliver daily summary.
- Create reminder.
- Update reminder.
- Complete reminder/task.
- Update assignment status.
- Add assignment note.
- Preserve pending confirmation behavior.
- Preserve ignored/pending/actionable bucket behavior.
- Preserve submitted-but-ungraded handling.
- Show dashboard health.
- Alert on login/session failure.
- Alert on scrape or delivery failure.
- Run offline tests and story gate.

## Rollback Plan
- Keep current production Docker + Telegram runtime as the rollback target.
- Do not migrate data ownership until a separate migration decision is approved.
- Keep OpenClaw beta, managed agent, or any new shell isolated from production unless explicitly promoted.
- For any provider/runtime spike, preserve the ability to return to the existing GPT-5.2 Telegram agent path.

## Open Questions
- What is the minimum useful feedback loop that materially accelerates this ChatGPT/GitHub workflow?
- Can the accelerator remain validation-only at first?
- Does Claude tooling provide a better local feedback loop than the GPT path?
- Which parts of the OpenClaw beta should be retained as reusable gateway lessons even if OpenClaw is not promoted?
- What is the exact threshold for replacing Telegram versus keeping it as the parent-facing interface?
