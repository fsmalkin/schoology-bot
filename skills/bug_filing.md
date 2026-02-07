# Bug Filing Skill

Goal: file a complete bug report without empty titles/bodies.

Process:
1) Draft a concise report with:
   - Title
   - Summary
   - Steps to reproduce
   - Expected vs actual
2) Validate that title and body are non-empty.
3) Submit via the bug tool call.
4) Echo back the exact title and a short summary of what was filed.

Guardrails:
- Never submit if the body is empty.
- If the user says "you decide", auto-generate a short title and draft.
- Keep the report under ~12 lines; be specific and concrete.
