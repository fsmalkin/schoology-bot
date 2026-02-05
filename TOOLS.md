# TOOLS

This file is a short description of available tools and their expected behavior.
The agent should treat tool results as source of truth and avoid guessing.

System expectations:
- Prefer library-first solutions before custom logic.
- If a tool returns an error, summarize once and ask for the minimum missing detail.
- Use pending actions for multi-step confirmations.
