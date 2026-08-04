# 02 — Adversarial review A: `schelm-node-http-server`

Verdict: **reject round-1 design**. The direction is sound, but several claims
are either infeasible as written, under-specified at hostile network boundaries,
or unsupported by the first spike. Production implementation must not begin.

## 1. Critical: `onEffects` can be held hostage by network lifetime

The round-1 API sketches commands whose results occur at `finish`, `drain`, or
graceful close, but it does not state how the effect manager avoids awaiting
those long operations inside `onEffects`. An effect manager that chains a
pending response or close task from `onEffects` blocks later commands and
subscription reconciliation. A slow client could then stall the entire manager,
including unrelated listeners and cancellation.

Required correction: `onEffects` may do bounded synchronous registry mutation
and dispatch only. It must return promptly. Long physical completions report to
the manager through kernel callbacks that enqueue `SelfMsg`; `onSelfMsg` claims
state, sends the current application event, and returns promptly too. No socket,
body, response, close, or deadline promise may be awaited by the manager's
effects-wave task.

## 2. Critical: command/subscription ownership is unresolved

Round 1 leaves “callbacks at listen versus subscriptions” open. This is not a
cosmetic API choice. Listener lifetime cannot be owned by subscriptions because
TEA subscriptions are recalculated and can temporarily disappear during model
transitions. Conversely, storing an application tagger forever at `listen`
means `Cmd.map`/model routing can become stale.

Required correction:

- commands own lifecycle: listen, body demand, response/write/end, upgrade
  decision, and close;
- subscriptions declare current event routing only;
- every reconciliation increments a routing generation per listener;
- queued manager events carry listener id plus generation or are re-tagged only
  after current-route lookup;
- stale taggers are never invoked;
- when routing is absent, behavior is bounded and explicit rather than an
  unbounded event queue.

The design must specify absent-routing behavior separately for requests,
upgrades, body/write completion, fatal listener events, and close results.

## 3. Critical: the proposed harness migration has no feasible upgrade bridge

Round 1 says package-owned HTTP may leave existing `ws` upgrade handling
“adapter-owned,” but Node emits `upgrade(req, socket, head)` on the server object
owned by the package. Existing `wire.js` cannot independently receive that
event without either owning the listener or receiving the exact private Node
objects. A public raw-socket API would destroy the package boundary.

Required correction: feasibility-spike a **private package-owned adapter** that
stores the exact `req`, `socket`, and `head` in the listener registry, exposes
only an opaque upgrade id to Elm, and transfers those objects exactly once to a
pinned `ws` `WebSocketServer({ noServer: true })` via `handleUpgrade`. Claim must
remove the offer before calling foreign code; reject, timeout, close, or duplicate
claim must be terminal/idempotent. Pin/version/provenance and old/new harness
traces are mandatory. Without this proof, listener migration cannot proceed.

This adapter is a harness integration bridge, not a public WebSocket server API.
WebSocket messaging remains a separately reviewed feature.

## 4. Critical: limits are local, but exhaustion is aggregate

Per-request caps do not stop an attacker from opening many requests, listeners,
connections, upgrades, body readers, or blocked writers. Round 1 mentions a
candidate maximum active exchange count but does not define global/listener
budgets, admission order, reservations, or release invariants.

Required correction: specify immutable package-global hard ceilings and
per-listener configured ceilings for listeners, TCP connections, active HTTP
exchanges, aggregate retained request bytes, aggregate retained response bytes,
pending writes, upgrade offers, and upgraded connections. Admission must reserve
before allocation/delivery and release exactly once at terminal absence. Define
what the peer receives when each budget is exhausted and prove one listener
cannot consume the global emergency reserve needed to reject/close work.

## 5. Critical: every waiting state needs a deadline

Round 1 has request idle and graceful close deadlines, but omits or blurs:
application response-decision time, header parse completion, request body
progress, response write/drain, keep-alive idle, upgrade decision, and upgrade
handshake. A state with no bounded exit is a leak under adversarial clients or
an absent subscription.

Required correction: identify the owner, start point, cap, reset rule, terminal
action, and error/event for every deadline. Slowloris defense must primarily use
Node server parser/socket knobs (`headersTimeout`, `requestTimeout`,
`keepAliveTimeout`, `keepAliveTimeoutBuffer`, `maxHeadersCount`,
`maxRequestsPerSocket`) configured before listen—not a userland timer that begins
after Node finally emits `request`.

## 6. Critical: over-limit behavior can poison keep-alive parsing

“Destroy or drain according to reviewed rules” is not a design. After an
application rejects a body, blindly returning a response while unread request
bytes remain can corrupt reuse or retain memory; blindly draining an unbounded
body defeats the cap.

Required correction: exact policy:

- head/parser violation: Node/client parse error path, send bounded 4xx only if
  safe, then close;
- declared `Content-Length` over limit: reject before body delivery, set
  `Connection: close`, send bounded 413, destroy after flush/close deadline;
- chunked/unknown body crossing limit: stop reading, claim `BodyTooLarge`, set
  non-reusable, bounded 413 if response unclaimed, then destroy; never drain the
  remainder;
- application early response/discard: drain only up to a separate small discard
  budget and body-progress deadline; EOF permits reuse, budget/deadline crossing
  destroys;
- malformed transfer or conflicting framing: never reuse.

## 7. Major: HTTP parser semantics are too vague

The design does not settle duplicate `Content-Length`, `Transfer-Encoding`, raw
versus joined headers, trailers, parser errors, informational responses,
`Expect: 100-continue`, CONNECT, absolute-form targets, or Node's normalization.
A duplicate-preserving header list is necessary but insufficient.

Required correction: broad v1 must define its HTTP/1.1 semantic surface. Use
Node's parser as the physical parser and preserve bounded `rawHeaders`; expose
normalized lookup as derived facts. Reject unsupported `CONNECT`, unsupported
expectations, and unsafe framing. Expose trailers only after body completion as
bounded duplicate-preserving facts. Make body existence/framing facts explicit.
Do not reconstruct an absolute URL from hostile `Host`.

## 8. Major: client abort and response completion are conflated

Node request `aborted`/`error`/`close`, response `finish`, and response `close`
mean different things. `finish` means bytes were handed to Node, not delivered
to the peer; `close` may follow successful finish or precede it. Round 1 says
this generally but lacks a race table and terminal precedence.

Required correction: registry state must claim one application terminal outcome:
client abort before complete request body => request/body abort; response close
before finish => write failed/peer closed; finish first => response accepted by
Node, later close is connection lifecycle only. Late callbacks clean physical
resources but cannot emit a second terminal result.

## 9. Major: first feasibility evidence overclaims backpressure and cancellation

The generated fixture writes through `write(false)`/`drain`, but reports no
counts or maximum buffered bytes, so it does not prove the branch ran. Its
“pre-listen cancellation” discussion was inferred from a scheduler boundary; no
actual cancelled bind attempt was executed.

Required correction: instrument false-write count, drain count, and maximum
`writableLength` against a paused real client. Execute cancellation after
`listen()` dispatch but before `listening`, verify no ownership transfer, verify
port release, and run the production-shaped debug/optimized manager path later.
Fixture-only positive controls must be stripped from production artifacts.

## 10. Major: close and event routing need bounded absent-subscriber behavior

A missing route cannot mean “queue until someone subscribes”; that is unbounded
and can resurrect stale events. It also cannot silently leave a request socket
open. Listener fatal and close completion events matter even if the route was
briefly absent.

Required correction: no generic event backlog. New requests/upgrades without a
current route receive bounded immediate rejection and close. Body/write demand
is command-driven, so no unsolicited chunks are produced. Terminal lifecycle
facts may be retained as one coalesced status per listener and delivered only
to a current generation, or returned via command-owned reply taggers whose
lifetime is explicitly manager-owned. Pick one model and property-test it.

## 11. Major: global provenance and bounded testing are deferred too loosely

The design names test families but not reproducible evidence. The upgrade bridge
would depend on `ws`, yet no package pin/archive hash/license/source provenance
is proposed. Random tests alone will miss short race sequences.

Required correction: lock compiler, Node, public package seed, and `ws` source
archive with SHA-256; generate a manifest from the tested commit; run bounded
exhaustive command/event traces before random long traces; run debug/opt and
cold/warm overlay builds; and ensure archive/artifact gates reject fixture code,
absolute harness paths, observation hooks, and undeclared runtime dependencies.

## 12. Scope ruling

A coherent broad HTTP v1 remains feasible and should include bind, request/head
facts, bounded pull bodies, responses and streaming writes, admission budgets,
upgrades as opaque decisions, connection facts, and graceful close. A public
WebSocket connection/message API is **not** accepted into this HTTP design. It
requires separate feasibility, adversarial review, state models, frame/message
limits, close handshake, ping/pong, and backpressure evidence.

Round 1 is rejected until a revision closes every critical issue and turns each
major issue into a concrete invariant or test gate.
