---
name: bug-filing
description: Draft and file bug/feature requests in GitHub (no local tickets or tasks).
metadata: {"openclaw":{"requires":{"env":["GITHUB_REPO","GITHUB_TOKEN"]}}}
---

When the user asks to "log a bug", "file a feature request", or "create a ticket",
use this skill instead of creating a task or local note. Do not fall back to
Schoology tasks for tickets.

Process:
1) Draft a concise report with:
   - Title
   - Summary
   - Steps to reproduce
   - Expected vs Actual
2) Confirm required fields are present (title + body).
3) Submit the GitHub issue.
4) Reply with the issue URL.

API call pattern (use system.run):
- Use the helper script: /home/node/.openclaw/workspace/tools/github_issue.js
- Pass a single JSON payload as one argument:
  {"title":"...","body":"...","labels":["bug"|"feature", "..."]}

Example:
node /home/node/.openclaw/workspace/tools/github_issue.js '{"title":"Daily summary missing notes","body":"Summary...","labels":["bug"]}'

Output:
- Plain text only. Use short lists with "-" or "1.".
- No HTML tags. No Markdown code fences.
