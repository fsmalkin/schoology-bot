# Codex Execution Plans (ExecPlans)

This file defines how we create and maintain execution plans for larger work.

## Purpose
- Make complex work predictable and reviewable.
- Keep scope, risks, and validation explicit.
- Provide a living plan that is updated as we learn.

## When to use an ExecPlan
Create an ExecPlan when work is:
- Multi-step or multi-hour
- A refactor or redesign
- Multi-milestone with dependencies
- Risky (could break prod, data, or UX)

## Where to write the ExecPlan
- Use this file as the single ExecPlan document.
- Keep it current while you work (it is a living plan).

## Required content
An ExecPlan must include:
- Goal
- Scope and non-goals
- Constraints and assumptions
- Risks and mitigations
- Step-by-step plan with milestones
- Validation plan (tests + checks)
- Rollback plan
- Open questions (if any)

## ExecPlan template (use this structure)

Title:
<short plan title>

Last updated:
YYYY-MM-DD

Goal:
- What outcome we want, in one or two sentences.

Scope:
In scope:
- ...
Out of scope:
- ...

Constraints and assumptions:
- ...

Risks and mitigations:
Risk:
- Description:
- Impact:
- Mitigation:

Plan:
Phase 1 - <name>
Tasks:
- ...
Dependencies:
- ...
End state:
- ...

Phase 2 - <name>
Tasks:
- ...
Dependencies:
- ...
End state:
- ...

Validation plan:
Unit tests:
- ...
Integration tests:
- ...
Smoke tests:
- ...
Manual checks (if any):
- ...

Rollback plan:
- How to revert quickly if needed.

Open questions:
- ...

Notes:
- Decision log or important context.

## Plan change rules
- If the plan changes, update this file immediately.
- Keep a short change log in Notes with date and reason.

## Format rules
- ASCII only.
- Plain Markdown.
- No code blocks unless explicitly required.
