# Schoology current-term adapter source

This private Node source package exposes one transport-neutral tool,
`get_current_term_summary`. Its `adapter.js` imports the accepted pure
`src/current_summary.js` from this checkout. Keep the whole checkout available;
this directory is not a self-contained distributable ZIP or installable
ChatGPT plugin. There is no plugin manifest, MCP endpoint, server launcher,
account binding or deployment in this increment.

## Host integration contract

Import `createCurrentTermSummaryTool` from `./adapter.js`. Construct it inside
the host's authenticated subject/request context with a trusted
`readCurrentTermSnapshot` function. Register only `definition` and `call` with
the qualified transport. The JSON input schema is an empty object with extra
properties refused; the handler also rejects arguments before invoking a reader.

The reader takes no arguments and returns an in-memory envelope:

```js
{
  format: "schoology-qualified-current-term/v1",
  subjectVerified: true,
  currentTermVerified: true,
  currentTerm: { id: "host-qualified-period", label: "Current term" },
  snapshot: {
    format: "schoology-current-assignments/v1",
    sourceOrigin: "https://bcps.schoology.com",
    observedAt: "ISO timestamp of the actual observation",
    complete: true,
    assignments: [/* approved current course/title/dueDate/status/isMissing/url */]
  }
}
```

The host must authenticate each request and independently bind the configured
student, current term and every input row. Qualification flags are declarations
at that trusted boundary, not proof of live authorization or correct coverage.
Never let model arguments supply this envelope, reader, account, term or source.
The reader must not refresh, write, log private payloads, drain reminders or
fall back to saved state. No reader is connected by default: calls return
`unavailable`, not an empty list or a login/key-entry instruction.

Only the six approved assignment fields reach current-term normalization or
returned items. Source times, coverage, counts and a bounded term label are the
only metadata returned. Internal term/student/account identifiers, grades,
scores, bodies, comments, notes, manual statuses and reminders are omitted.
Submitted work is excluded by the existing logic. Same-origin HTTPS links lose
query strings and fragments. Coursework strings remain untrusted data.

Freshness is checked after the reader completes, using the existing 15-minute
limit. Unverified scope, stale/malformed input and reader failures return fixed
unavailable results without echoing exceptions. At most 50 missing items are
returned within a 48 KiB serialized response budget; counts explicitly disclose
omissions, separately from source completeness. Text and structured output use
the same selected items; omitted titles do not leak through the text summary.
The adapter writes no state.

## Checks and remaining boundary

Run `npm run test:chatgpt-adapter` from the repository root. Tests use only
fabricated in-memory snapshots and guarded subprocess imports. They do not
read Schoology, credentials or original stores, or start a server.

Builder has identified a candidate Sites-hosted private MCP transport with
managed OAuth and per-user authorization. No endpoint or account binding was
created. That path still needs an authorized current-input provider, target
account and phone eligibility, plus actual build/transport/authentication proof.
Source/package checks do not prove live data, installation, account/mobile
availability or consumer delivery. No placeholder `mcp.json`, invented endpoint,
upload, hosting activation or public publication is supplied here.
