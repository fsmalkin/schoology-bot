# Relay failure diagnostics after source recovery

Actor: server-local Chasebox recovery executor; not an owner ruling.

The recovered October relay discarded HTTP/API failure details and returned
process success after recording a held failure. The isolated recovery patch
preserves typed provider diagnostics and makes held execution exit with code 2.
Operators can then distinguish provider refusal from transport failure while
retaining the original operation receipts.

The source starts from published commit
`be6fe2481cf7ba7cbcc3b2ebe9f8d659f448e6e4`. This patch reconstructs two identified
gaps; it does not recover the missing November 9 correction's bytes or qualify
the v50 worker for continuation.

`Invoke-RelayApi` retains a single request per invocation. Fixed failure messages
carry an allowlisted method and category. HTTP status and API error code are
integers; only a 429 response can retain an integer retry-after of 1-60 seconds.
Provider text and exception inners stay out of the generated exception and
durable diagnostics. Malformed JSON and wrong top-level or `ok` types fail closed.

The poll loop retains its existing three transport retries. Typed HTTP/API
failures remain outside that branch. Recorded retry-after metadata grants no
new retry, recovery admission or reset of an earlier allowance. The outer catch
preserves held state and safe failure metadata, then closes resources before
reporting failure to the entrypoint. Existing state and lock files remain for
owner reconciliation.

## Offline verification

The new suite exercises 25 scenarios through 157 assertions: 21 provider-failure
fixtures, success, an unsupported method and two real child-entry fixtures.
Its HTTP client uses an in-memory handler. A generated broker stub throws before
credential access in the child-entry fixtures. The exact baseline exits 0 after
writing HELD_NO_AUTOMATIC_REPLAY; the candidate preserves that state and exits 2.
Both retain the lock with zero polls and requests. Every generated fixture is
removed after its child has exited.

The first suite run found that PowerShell JSON integers are Int64; the typed
checks were corrected. An added top-level-array control then exposed PowerShell's
broad PSCustomObject type test, which was corrected with the actual CLR type.
Both failures preceded the final passing run.

| Suite | Passing assertions |
| --- | ---: |
| `telegram_failure_metadata.test.ps1` | 157 |
| `telegram_subscription.test.ps1` | 59 |
| `telegram_progress.test.ps1` | 14 |
| `telegram_connected_browser.test.ps1` | 27 |

The fixtures use no real credentials or provider calls. They launch no worker
and send no message. This evidence covers the changed failure handling rather
than production recovery or browser authentication.

## Remaining restoration requirements

Current ALEPH-383 records preserve the v50 pending queue as UNKNOWN and its prior
429 delayed read/502 failure as spent. Exact launch/lifecycle custody and pending
input validation still require recovery. Phase-aware health remains a separate
gap in the October baseline. The missing November source remains unavailable
after the recorded inquiry.

The desktop-plugin lane stays stopped under Fred's recorded direction. Its
missing enrollment does not authorize creating a replacement connection or
using an earlier term/store. Original runtime-directory enumeration returned
OS AccessDenied here, and no alternate protected-file read followed. The active
Telegram path needs its original state reconciled through the existing
administrative/source owner before installation or live qualification.

All original sends and prior provider operations remain closed to replay.
The change stays isolated under `codex/recovery-relay-resilience-20261117`;
the existing recovered checkout and its source/data remain intact.

References: [ALEPH-383](https://linear.app/factr/issue/ALEPH-383),
[November 9 preserved operation](https://github.com/fsmalkin/aleph/issues/453#issuecomment-6740626950),
[Chasebox restoration](https://linear.app/factr/issue/ALEPH-605).
