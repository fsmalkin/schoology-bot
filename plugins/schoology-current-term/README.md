# Schoology current-term adapter source

The parent outcome remains a usable assignment conversation on the agreed
consumer surface. A manual summary, this source package or the independent
weekly calendar is not completion of that outcome.

This private whole-checkout source package contains one read-only tool,
`get_current_term_summary`, and a stateless Web API MCP handler. Its `adapter.js` imports the accepted pure
`src/current_summary.js` from this checkout. Keep the whole checkout available;
this directory is not a self-contained distributable ZIP or installable
ChatGPT plugin. There is no plugin manifest, published MCP endpoint, server
launcher, account binding or deployment in this increment.

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

## MCP request/response handler

`mcp_handler.js` exports `createCurrentTermMcpHandler`. The returned function
accepts `(request, trustedHostContext)` and returns a standard Web `Response`;
it opens no listener. The package's `./mcp` export points to this module.

Supply a server-owned `authorizeRequest(trustedHostContext)` callback. It is
called separately for every supported request, including discovery, and must
return either no grant or `{ principalId, authorizedScope, readCurrentTermSnapshot }`.
The server-owned `authorizedScope` contains the exact `studentId` and
`currentTermId` authorized for that caller. A valid grant needs these bounded,
nonempty identifiers and a no-argument reader closure already bound to that
caller, student and current term. A principal ID or qualification booleans
without this capability are refused before any provider access.
The handler captures that reader and scope for
only this invocation and constructs a fresh adapter. It stores no principal,
grant, reader or session between requests. Principal IDs are not returned.

For the MCP handler, the provider's qualified envelope also declares
`sourceScope: { principalId, studentId, currentTermId }`. The handler compares
all three against the independently obtained host grant and also compares the
envelope's `currentTerm.id`. A missing or mismatched declaration produces the
same fixed unavailable result, before assignment data is returned. These
internal scope fields are omitted from the result. This is a consistency
check between trusted declarations, not observed Schoology binding proof.
The actual host/provider must verify caller authorization, selected student,
current period and row membership; a matching declaration cannot replace that
verification. Existing scraper/DB/history APIs are not qualified readers.

The context must come from the host's validated identity/permission boundary.
Do not construct it from the JSON body, model arguments, raw identity headers,
session IDs, or qualification flags. This module deliberately does not read
authentication tokens or infer identity from request headers. No callback or
no grant produces HTTP401; malformed/denied grants and authorization failures
produce HTTP403. A valid grant whose reader lacks qualified data produces the
adapter's fixed unavailable tool result. Grant declarations in fixtures are
not live authentication proof.

The implemented compatibility profile is MCP `2025-11-25`, with `initialize`,
`tools/list`, `tools/call` and `ping`. Initialization returns the supported
version; operations require its `MCP-Protocol-Version` header. Clients still
perform initialization; the handler keeps no lifecycle/session cache. This
does not claim support for other protocol revisions. See the official
[MCP lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle).

The route is JSON `POST /mcp`. Clients send an Accept header containing both
`application/json` and `text/event-stream`; responses use JSON. GET and DELETE
return405 because SSE/session termination is not implemented. Validly shaped
notifications return an empty202 and never execute a tool. Unknown methods,
unknown tools and malformed calls return fixed JSON-RPC errors; refused tool
arguments and unavailable source data remain tool errors. See the official
[HTTP transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)
and [tool error contract](https://modelcontextprotocol.io/specification/2025-11-25/server/tools#error-handling).

UTF-8 request bodies are capped at16 KiB while reading, including streams
without a declared length; oversized streams are cancelled. The adapter's
48 KiB/50-item result limit is preserved inside a49 KiB JSON-RPC envelope
budget. Request IDs are bounded, private exceptions are not echoed, and
responses use `Cache-Control: no-store`. A present Origin header must match an
explicit, exact HTTPS `allowedOrigins` entry; the default list is empty.

The actual host still owns validated ingress identity, OAuth challenges,
request deadlines and per-principal rate limiting. Sites manages connection
sign-in; the approved Schoology connection and per-user record permissions
remain separate, as described in the official
[Sites connection guidance](https://learn.chatgpt.com/docs/extend/mcp#2-connect-your-system).
No OAuth/app/host configuration or live observer binding is supplied here.

## Trusted current-gradebook reader

The package subpath ./gradebook-reader exports
createCurrentTermGradebookReader. It joins a host-owned document observer to
the existing request-owned MCP grant. The observer receives the fixed
projectCurrentGradebook function and an immutable scope containing the
authenticated principalId, approved studentId, actual currentTermId
and currentTermLabel. These values come from the trusted host; none are
model arguments. Construct the reader inside each authorized request and
return it as that grant's readCurrentTermSnapshot.

The observer must execute the fixed projector in its sanctioned read-only
document context and supply document, observed origin/pathname, the
actual source observedAt, and the supplied scope as expectedScope.
This constructor creates no browser connection, remote-access permission,
session, login, navigation, source refresh or background worker. An opaque
function or matching metadata does not independently prove source access.
The existing host authorization and actual observer admission remain required.

The projector accepts only the official Grades view, an unambiguous own-account
Your Profile menu item and the expected original profile. Each course needs
one expanded current period matching both the host-qualified ID and label.
Assignment ancestry must terminate in an actual period through unique row IDs.
Other periods are excluded; orphan/cyclic/duplicate bindings refuse the input.
Only title-column title/due/link and official exception/submission markers are
read. Numeric grades, comments and full row text are never inputs.

Layout evidence, hidden current rows, loading and pagination determine honest
complete/partial coverage. Missing layout support yields partial coverage,
not invented completeness. Source observation time is preserved; the existing
adapter checks its age after the observer returns. The browser-side function
uses plain ECMAScript for its conservative size bound and does not need
TextEncoder or a Node API. The Web MCP host still supplies its standard Web
APIs separately.

npm run test:current-gradebook exercises the actual new reader through MCP
initialize/list/call and a later changed-source call. Fabricated DOM fixtures
also cover subject/period mismatches, row ancestry, stale observations,
submitted precedence, private-field refusal and interleaved callers. They do
not prove a live browser bridge, hosted endpoint, intended account or phone.

## DOM projection source seam

`src/schoology_dom_rows.js` separates the existing `readGradebookRows` callback
from the browser/session module. The existing scraper serializes that function
with `page.evaluate`; the DOM body is retained, with origin passed explicitly
and the same BCPS fallback. The callback still produces the legacy internal
row shape, including grade/comment/raw signals needed by that existing path.

`projectGradebookAssignmentFields(rows)` reduces those rows to the six allowed
assignment fields. Statuses become canonical missing/incomplete/submitted or
unmarked labels; freeform feedback, grades, raw text, manual annotations and
internal scope fields are omitted. Links are restricted to the BCPS HTTPS
origin and lose query/fragment data. The function preserves input rows and
refuses malformed or oversized fields.

This projection returns only an array. It does not acquire data, select a
student/period, create observation/coverage declarations or qualify a snapshot.
Current/Past labels and a recent timestamp do not establish row membership.
A DOM-based provider must establish scope/coverage independently, minimize its
rows, then satisfy the handler's host/provider contract. The old HTML wrappers
still launch a browser and remain unsuitable as a no-side-effect reader.

Run `npm run test:schoology-dom`. Its small in-memory DOM double tests row
semantics and actual function serialization with explicit Web globals; it is
not a real browser, HTML parser or CSS conformance test. A fabricated source
flows through the real MCP tool only after separately supplied matching fixture
scope, while missing/wrong/ambiguous labels and mixed/incomplete views remain
unqualified. This supplies no actual student/term or account eligibility proof.

## Checks and remaining boundary

Run `npm run test:chatgpt-adapter` from the repository root. Tests use only
fabricated in-memory snapshots and guarded subprocess imports. They do not
read Schoology, credentials or original stores, or start a server.

Run `npm run test:chatgpt-mcp` for fabricated Web request/response cases. The
fixtures explicitly supply the standard Web APIs they use. They cover protocol
and authorization errors, actual adapter calls, mismatched caller/student/period
providers, two concurrent synthetic subjects and later grant refusal, malformed/bounded streams, response limits,
and a guarded no-I/O import path. These are Node request/response checks;
they do not establish browser/Worker bundle compatibility or replay the
separate, already-spent Builder qualification.

Builder has identified a candidate Sites-hosted private MCP transport with
managed OAuth and per-user authorization. No endpoint or account binding was
created. That path still needs an authorized current-input provider, target
account and phone eligibility, plus actual build/transport/authentication proof.
Source/package checks do not prove live data, installation, account/mobile
availability or consumer delivery. No placeholder `mcp.json`, invented endpoint,
upload, hosting activation or public publication is supplied here.
