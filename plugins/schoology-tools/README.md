# Schoology Tools - private local connector

This plugin connects ChatGPT/Codex desktop to the retained Schoology app. Its
MCP server uses the standard UTF8 newline-delimited JSON-RPC stdio transport.
It opens no listener, starts no poller/model/schedule and bundles no credentials
or student records. The connector itself uses only Node builtins. The existing
Schoology application and its dependencies are separately installed prerequisites;
this is not a self-contained redistribution of that application.

The host launches `node ${PLUGIN_ROOT}/server.mjs`. Enrollment lives at
`~/.schoology-tools/connection.json`, outside the package. An explicit local
launch can instead use `node server.mjs --connection <absolute-file>`.
Only the owning setup task writes this metadata file. It binds:

- `format`: `schoology-local-plugin-connection/v1`;
- absolute `backendRoot`, `toolConfigPath`, `operationDirectory` and
  `sourceAuthStatusPath`;
- `toolConfigSha256` and a `backendFiles` relative-path/SHA256 map containing
  the fixed backend CLI, every JS/JSON module under src, package.json and the
  dependency lock. Installed runtime dependencies remain a separate prerequisite;
- exact `principalId`, `studentProfileId`, `currentTermId` and `currentTerm`.

The fixed CLI is `scripts/schoology_plugin_backend_cli.mjs`. It calls the same
original subscription-tool engine and SQLite store as Telegram. The plugin
namespace is accepted only by that CLI's trusted configuration; normal Telegram
execution retains its `telegram-update-N` namespace. The existing running
Telegram checkout remains separate from the plugin development checkout.

Every data tool requires a stable caller-owned `schoology-plugin-...` operation
ID. One durable receipt is exclusively reserved before the one backend call.
An existing, failed or ambiguous ID is never re-executed. Recover its status
and saved result through `schoology_operation_status`; changing IDs to retry an
uncertain logical operation violates the client contract. This is per-key
protection, not proof that a client cannot deliberately choose another ID.
Local edits also use the original SQLite effect journal and freshness checks.

Tools: connection/operation status, saved assignment list, saved summary,
code-driven refresh, and explicit single-assignment local note/status add/clear.
No imports, bulk changes, Schoology writes, files, grades, messages, reminders,
model API or arbitrary dispatcher commands are exposed. The source-session
status must record completed app sign-in before plugin refresh may launch the
headless reader. An expired session still returns the original refusal.

Private installation must verify startup, discovery and one useful consumer
call in the actual host. CI fixtures and a packaged archive establish their
bounded properties only. A local plugin requires desktop execution and an
enrolled app on that machine; account upload does not deploy a backend or
establish mobile access. The existing exact app-window sign-in Task remains
the authentication action; this plugin creates no replacement Task.

The repository marketplace is `.agents/plugins/marketplace.json`, named
`schoology-private`, with this directory as its local source. Register the
repository root with `codex plugin marketplace add <absolute-repository-root>`.
The supported installed CLI can install `schoology-tools@schoology-private`;
desktop discovery and an actual local consumer call still need verification.
Edit the source directory and refresh through the host; never edit its cache.

Protocol: https://modelcontextprotocol.io/specification/2025-11-25/basic/transports
Packaging: https://developers.openai.com/plugins/build/plugins
