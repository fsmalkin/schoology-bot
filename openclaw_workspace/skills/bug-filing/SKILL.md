---
name: bug-filing
description: File bug reports and feature requests through Schoology Tool API and return a tracking URL when available.
metadata: {"openclaw":{"requires":{"env":["SCHOLOGY_TOOL_API_URL"]}}}
---

Use this skill when user asks to file/log/open/track a bug or feature request.

API call pattern (use system.run):
node /home/node/.openclaw/workspace/tools/schoology_api.js '{"tool":"open_bug_report","args":{"title":"...","body":"...","labels":["bug"]}}'
node /home/node/.openclaw/workspace/tools/schoology_api.js '{"tool":"open_feature_request","args":{"title":"...","body":"...","labels":["enhancement"]}}'

Rules:
- Always ensure title is non-empty before calling.
- If user says "you decide", synthesize title/body from context.
- Prefer GitHub issue creation when configured; otherwise return local log path.
- After filing, report issue URL if present; otherwise report saved path and title.

Output:
- One confirmation block: type, title, destination (URL or file), and next step.
