# 03 — Design revision A: `schelm-node-http-server`

Status: response to adversarial review A. No production implementation is
authorized. This revision supersedes conflicting parts of `01-design.md`.

## 1. Scope and accepted split

Broad HTTP v1 remains one coherent Node HTTP/1.1 package:

- explicit loopback/public TCP bind;
- one manager-owned listener fact;
- bounded HTTP parser/head facts and pull-driven request bodies;
- buffered/streaming responses with physical backpressure;
- bounded admission at package and listener levels;
- opaque upgrade decisions and a private pinned-`ws` harness adapter;
- connection lifecycle facts and deadline-bounded graceful close.

The public WebSocket connection/message API is removed from HTTP v1. A later
`Schelm.Node.WebSocketServer` feature requires its own feasibility artifact,
two reviews, model/property plan, and implementation evidence. The private `ws`
bridge exists solely so the package can own the harness's one HTTP listener
without regressing current wire behavior.

## 2. Effect-manager execution law

**`onEffects` never waits for network lifetime.** It performs only:

1. bounded command validation/registry transition;
2. synchronous dispatch of a Node verb;
3. subscription-route reconciliation;
4. `Task.succeed nextState`.

Node callbacks enqueue small kernel facts to `Platform.sendToSelf`. They do not
call application taggers directly. `onSelfMsg` performs one bounded registry
transition, resolves the current route or command reply, starts at most bounded
follow-up work, and returns. No manager task awaits listen, request body data,
`drain`, `finish`, upgrade handshake, graceful close, or a timer.

```text
Elm command -> onEffects: reserve + dispatch -> returns
Node callback -> rawSpawn(sendToSelf Fact)
onSelfMsg -> claim registry state -> sendToApp current route/reply -> returns
```

A kernel callback may fire synchronously while dispatch throws or returns. The
registry entry is installed first; terminal claiming is idempotent. Long
completion is represented by presence in the registry, never by a suspended
`onEffects` task.

Command processing is O(number of commands in this effects wave), with commands
consed/reversed or array-indexed; no end append. A malicious application can
still emit a large `Cmd.batch`, so `onEffects` admits only the configured bounded
number of new operations and rejects the rest through prompt self facts.

## 3. Lifecycle commands versus current subscriptions

### Commands own resource transitions

Commands are the only way to:

- start/cancel a bind attempt;
- demand/discard a request-body chunk;
- claim/send/stream/abort a response;
- write/end a stream;
- accept/reject/hand an upgrade;
- begin/join listener close.

A lifecycle command captures a **reply tagger** only when it has a one-shot
result (`ListenResult`, `WriteResult`, `CloseResult`). The manager stores that
mapped tagger with the operation until one terminal self fact, then deletes it.
`Cmd.map` maps stored reply taggers lawfully.

### Subscriptions own current unsolicited-event routing

```elm
type Event
    = RequestOffered Listener Request BodyReader Response
    | UpgradeOffered Listener Upgrade
    | RequestAborted Listener RequestId AbortReason
    | ListenerFailed Listener RuntimeError

onEvents : Listener -> (Event -> msg) -> Sub msg
```

Each effects wave reconciles `ListenerId -> Route { generation, tagger }`:

- same subscription identity still receives a fresh monotonically increasing
  generation and mapped current tagger;
- replacement atomically supersedes the prior route;
- absence removes the route; it does not close the listener;
- queued unsolicited self facts contain listener id and the generation observed
  when admitted;
- delivery requires current route generation equality; otherwise the fact is
  stale and follows its bounded fallback below;
- a tagger is read from the current route at delivery, never retained in Node
  callbacks or request registries.

Generation wraps only at the safe JS integer bound and skips generations still
referenced by admitted facts. Production kernel receives primitive ids and
plain records from Elm; it never decodes custom-constructor layout.

### No event backlog when routing is absent or stale

- new request: bounded 503, `Connection: close`, then response-close deadline;
- new upgrade: bounded HTTP 503 over the socket, then destroy deadline;
- request abort/listener failure: cleanup occurs regardless; at most one
  coalesced `lastFailure` fact remains in listener state for diagnostics, not an
  event queue;
- body chunks are never read without a command, so none can accumulate;
- write completion uses command-owned one-shot reply, not subscription routing;
- listen/close completion uses command-owned replies; duplicate close joiners
  are bounded by `maxCloseWaiters`, then rejected promptly.

A stale `RequestOffered` is actively rejected and its exchange removed. No stale
tagger is invoked, no event is held for a future subscription, and no network
resource waits for application routing to return.

## 4. Registry and ownership

One package-level manager registry owns all live resources:

```text
ManagerState
  { listeners : Map ListenerId ListenerState
  , totals : GlobalUsage
  , routes : Map ListenerId Route
  }

ListenerState
  = Starting StartingResources
  | Open OpenResources
  | Draining DrainResources

OpenResources
  { server, limits, usage, connections, exchanges, upgrades, timers, endpoint }
```

Node server/request/response/socket/timer objects exist only in kernel-private
maps keyed by primitive ids. Elm manager state mirrors lifecycle and counters;
production transition functions update both through narrow kernel verbs. A
settled listener/exchange/upgrade/write is absent. Release functions are
idempotent and decrement reservations exactly once.

Bind attempt cancellation is real ownership transfer:

```text
Starting (registry owns unlistened/listening-attempt server)
  -- cancel before Listening self fact --> remove entry, server.close, no result success
  -- Listening self fact claims entry --> Open (listener owns server)
  -- late cancel/listen/error fact -----> stale cleanup only
```

The runtime probe now executes `listen()` followed by pre-listening `close()`,
asserts zero `listening` events and immediate port reuse. Production acceptance
still requires this race through generated debug and optimized manager workers.

## 5. Aggregate budgets and admission

Limits have three layers:

1. immutable package hard maxima;
2. package-global runtime budget shared by every listener;
3. per-listener configuration no greater than global/hard maxima.

Required counters:

```text
listeners
connections
activeExchanges
retainedRequestBytes
retainedResponseBytes
pendingWrites
upgradeOffers
upgradedConnections
closeWaiters
pendingSelfFacts
```

Candidate hard maxima are not promises until measured, but no constructor can
select “unbounded.” Global defaults reserve at least one listener slot and a
small rejection reserve (connection + response head bytes) that normal admission
cannot consume. Admission order is:

1. validate listener-local limit;
2. reserve global and listener counters atomically;
3. allocate/copy/store resource;
4. emit self fact;
5. release exactly once on terminal absence.

Failure to reserve never partially admits. Connection exhaustion immediately
destroys a newly accepted socket. Exchange exhaustion sends bounded 503 only if
the rejection reserve and parser state make it safe; otherwise destroy. Upgrade
exhaustion sends bounded 503 and destroys. Retained-byte exhaustion stops the
read/write and follows the exact limit policy below. `pendingSelfFacts` prevents
Node callback storms from outrunning Elm; overflow rejects the associated
resource rather than enqueueing history.

Per-listener limits prevent one listener monopolizing normal capacity. Global
limits prevent many individually valid listeners from exhausting the process.
Global totals are updated O(1); event paths never scan listeners/connections.

## 6. Complete deadline table

Every waiting state has one capped deadline owned by the registry. Node parser
knobs are configured before `listen`; manager timers cover states Node cannot.

| Deadline | Starts / resets | Terminal action |
|---|---|---|
| bind | immediately before `server.listen` | cancel attempt; `ListenTimedOut` |
| headers | Node `server.headersTimeout` | Node parser closes or client error path |
| whole request | Node `server.requestTimeout` | Node timeout response/close, classified |
| decision | `RequestOffered` admitted; never resets | bounded 504 + close, or destroy if unsafe |
| body progress | each explicit `readBody` dispatch; resets only on non-empty chunk | abort exchange; close |
| discard | `discardBody`; reset on bounded progress | destroy on budget/deadline |
| write | each `write`; includes waiting for `drain`; resets only after command terminal | abort response/socket |
| response finish | `end`/buffered response dispatch | destroy if no `finish` |
| keep alive | Node `keepAliveTimeout` plus `keepAliveTimeoutBuffer` | Node closes idle socket |
| requests/socket | Node `maxRequestsPerSocket` | Node advertises close / returns 503 as documented |
| upgrade decision | upgrade offer admitted | bounded HTTP reject + destroy |
| private ws handshake | exactly-once handoff begins | adapter destroys socket and fails handoff |
| graceful close | close transition | force-close remaining owned resources |

`maxHeadersCount` is also set before listen. Header byte limits rely on Node's
`maxHeaderSize` process/server capability where available; unsupported required
knobs fail `UnsupportedRuntime` rather than silently weaken claims. The Node
compatibility fixture records effective values.

Slowloris defense belongs primarily to `headersTimeout`, `requestTimeout`,
`keepAliveTimeout`, `keepAliveTimeoutBuffer`, `maxHeadersCount`, and
`maxRequestsPerSocket`. Application decision/body/write timers start only after
Node emits the corresponding event and do not pretend to protect parser time.

## 7. HTTP/1.1 parser, headers, trailers, and bodies

Node core is the physical HTTP/1.1 parser. V1 does not implement a second parser.
It configures strict parsing (no `insecureHTTPParser`) and bounded parser knobs.
`clientError` is classified and closes the socket; it may send one fixed bounded
400/431 response only when headers have not already been sent and Node marks the
socket writable. Parser failures never enter the normal request model.

### Request target and method

Expose raw method token, raw request target, and HTTP version facts. Origin,
absolute, authority, and asterisk forms are classified, not normalized into a
trusted URL. `Host` remains a possibly missing/hostile header fact. Broad v1
supports ordinary methods as opaque valid tokens. `CONNECT` is rejected with
405 + close because raw tunnel ownership is absent. `Expect: 100-continue` and
other expectations are rejected with bounded 417 + close in v1; no automatic
100 response. Upgrade uses only the upgrade path.

### Headers

Copy bounded `rawHeaders` as ordered `(lowerName, value)` pairs, preserving
spelling only if a later diagnostics type can do so safely. Derived lookup
returns all values in arrival order. Never expose Node's lossy joined object as
the authority.

Before delivery, framing validation rejects:

- duplicate or comma-combined `Content-Length` unless Node already rejected;
  v1 chooses fail-closed even if values are identical;
- simultaneous `Transfer-Encoding` and `Content-Length`;
- unsupported transfer coding (anything other than Node-accepted final chunked);
- control characters/invalid field tokens;
- head count/byte budget crossing.

This validation is defense in depth over Node's strict parser and is property-
tested against raw socket fixtures.

### Body framing and trailers

`Request` exposes `BodyFraming = NoBody | FixedLength Int | Chunked`. Body bytes
are never inferred from method alone. Pull reads copy one bounded chunk. `EOF`
produces `BodyComplete Trailers`; trailers are copied from bounded
`rawTrailers`, duplicate-preserving, and pass the same name/value validation.
Trailers arriving before body EOF are not visible. Trailer limit/validation
failure makes the connection non-reusable and fails the body.

`IncomingMessage` `aborted`, `error`, premature `close`, declared-length
mismatch, or malformed chunk framing terminally produces `BodyFailed` /
`RequestAborted`. Exactly one wins.

## 8. Exact body over-limit and early-response policy

Connection reuse is earned only after safely reaching framed request EOF.

1. **Declared fixed length exceeds body limit before reading:** reserve no body
   bytes, mark non-reusable, claim response if free, send fixed 413 with
   `Connection: close`, then destroy after `finish`/close deadline.
2. **Chunked/unknown stream crosses body limit:** retain at most remaining limit
   plus one transport chunk transiently; emit no over-limit partial chunk; pause,
   mark non-reusable, claim `BodyTooLarge`, send fixed 413 if response unclaimed,
   then destroy. Never drain the remainder.
3. **Application calls `discardBody`:** drain at most configured
   `discardByteLimit` under body-progress/discard deadline. EOF with valid
   trailers permits reuse. Crossing budget/deadline destroys; discard never
   turns into an unbounded sink.
4. **Application responds before body EOF:** package automatically enters the
   same bounded discard mode only when response framing is safe and configured
   `allowBoundedAutoDiscard`; otherwise sets `Connection: close`. Reuse occurs
   only if bounded discard reaches valid EOF before response completion.
5. **Parser/framing/client abort failure:** never reuse; fixed error only if safe,
   otherwise destroy.

No error path consumes the global rejection reserve indefinitely; its response
has a fixed tiny body and a finish deadline.

## 9. Response/write semantics and real backpressure

Response validation covers status range, field syntax, hop-by-hop restrictions,
Content-Length consistency, HEAD, 1xx, 204, and 304 body prohibition. V1 sends no
informational responses. Buffered bodies reserve aggregate bytes before copying.
Streaming allows one write command in flight per response and reserves one
bounded chunk against listener/global retained-response budgets.

Physical states:

```text
Ready -- write --> Writing
Writing -- write(true) --> await callback/self fact --> Ready + WriteAccepted
Writing -- write(false) --> WaitingDrain -- drain --> Ready + WriteDrained
Writing/WaitingDrain -- error or close-before-finish --> Terminal PeerClosed
Ready -- end --> Finishing -- finish --> Terminal AcceptedByNode
```

`write(false)` stops immediately. No later chunk is accepted while blocked. The
runtime probe uses a paused real client and now records 64 false writes, 64
drains, 4 MiB exact receipt, and maximum observed `writableLength` about one
64 KiB chunk on the pinned runtime. Tests assert counts are positive/equal and
buffered length stays under a measured bound. Production generated debug/opt
fixtures must expose equivalent fixture-only counters, mechanically absent from
the package artifact.

Terminal precedence:

- request abort before valid body EOF => body/request terminal abort;
- response `close` before `finish` => response `PeerClosed`;
- response `finish` first => response `AcceptedByNode`; later socket close is
  only a connection lifecycle fact;
- `finish` never claims peer receipt or durability;
- late `error`, `close`, `drain`, or timer callbacks release physical handles but
  cannot produce a second Elm terminal event.

## 10. Concrete private pinned-`ws` upgrade adapter

### Feasibility result

`fixtures/feasibility/scripts/runtime-probes.cjs` now imports the harness-pinned
`ws` **8.21.1**, starts `WebSocketServer({ noServer: true })`, receives Node's
exact `upgrade(req, socket, head)` triple, stores it under an opaque id, deletes
the registry entry before `handleUpgrade`, echoes a real frame, rejects a
duplicate claim, and proves the registry is empty. Output records:

```json
{"wsVersion":"8.21.1","exactIdentity":true,"duplicateRejected":true,"registryEmpty":true}
```

This proves the necessary host boundary, not production integration.

### Production boundary

The package will include a private kernel module available only to the harness
adapter package/module—not exported from `Schelm.Node.HttpServer`:

```text
offer(req, socket, head)
  reserve upgrade budget
  store exact object identities + decision timer
  send opaque Upgrade id to Elm

claimForPinnedWs(id, adapterId)
  atomically remove offer first
  cancel decision timer
  call pinned adapter.handleUpgrade(req, socket, head, callback)
  callback reports handshake result via SelfMsg

reject/timeout/close(id)
  atomically remove offer
  write one bounded HTTP rejection if safe
  destroy by deadline
```

No public API can obtain `req`, `socket`, `head`, or register arbitrary JS. The
adapter allowlist is build-time package-private and contains the reviewed pinned
`ws` bridge only. The `ws` dependency must be an offline immutable archive with
version, source URL/commit if available, license, SHA-256, and dependency tree
in provenance. Runtime `require("ws")` from ambient `node_modules` is forbidden.
Old/new integration traces cover bare `/`, `/ws`, invalid paths, PortLink direct
and cookie-recovered paths, non-loopback rejection, initial `head` bytes,
handshake failures, duplicate/timeout claims, close, and backpressure.

The bridge returns an opaque legacy connection id to the harness-specific wire
adapter. It does not become broad package API and does not certify WebSocket
message lifecycle. Full WebSocket ownership remains the separate gate.

## 11. Graceful close and upgraded connections

Close first transitions `Open -> Draining`, removes event admission, calls
`server.close`, and starts one capped deadline. New HTTP requests/upgrades that
race after transition are rejected/destroyed. Active exchanges may finish;
keep-alive idle sockets are closed with Node's supported close-idle verb. The
registry tracks private-adapter upgraded connections so graceful completion
cannot report while they remain.

At deadline: destroy all remaining HTTP sockets, abort exchanges/writes, ask the
private adapter to terminate upgraded connections, then force-destroy their
owned sockets after the adapter sub-deadline. One `CloseReport` partitions
completed, rejected, and forced resources. Multiple close commands join one
operation up to bounded `maxCloseWaiters`; excess joiners receive
`TooManyCloseWaiters`. Listener removal happens once after physical cleanup has
been dispatched and all terminal counters are reconciled.

## 12. Models and bounded properties

The production transition model—not a toy alternative—will be extracted as
pure Elm functions over ids, phases, counters, routes, generations, and facts.
Required bounded exhaustive suites:

1. all listener sequences through depth 8: listen/cancel/listening/error/close/
   deadline/stale facts;
2. all route sequences through depth 8: add/replace/remove/admit/deliver with no
   stale tagger and bounded fallback;
3. all body sequences through depth 10 across fixed/chunked, read/discard,
   limit/deadline/abort/EOF/trailers;
4. all writer sequences through depth 10 across true/false/drain/finish/close/
   error/deadline;
5. all upgrade sequences through depth 8: offer/claim/reject/timeout/close/
   duplicate, exact one owner;
6. all budget admissions/releases for small global/per-listener capacities,
   proving `0 <= usage <= limits` and terminal zero;
7. close partitions for small sets of HTTP/upgraded connections;
8. parser corpus: raw malformed headers/framing/expect/CONNECT/trailers against
   real Node and the package classifier.

Properties:

- `onEffects` settles within a synchronous bounded harness step even when every
  physical callback is withheld forever;
- exactly one terminal event/reply per operation;
- terminal means registry absence and reservation release;
- no physical read without demand; at most one chunk/write retained;
- no event queue grows while subscription absent;
- no stale generation invokes a tagger;
- admitted totals never exceed listener/global/hard limits;
- byte order preserved and memory O(current bounded resources), not history;
- graceful close report partitions all owned resources exactly once;
- debug and optimized observable traces are identical.

Random long traces and real network failure injection follow bounded exhaustive
checks; they do not replace them. Performance tests cover 200 listeners (within
configured test hard cap), 1,000 requests, 10,000 chunks, absent routes, and
blocked clients, verifying hot event cost does not scan accumulated resources.

## 13. Provenance and artifact gates

The tested commit generates a machine-readable evidence manifest containing:

- repository commit and dirty-state rejection;
- Schelm compiler commit/binary SHA-256 and base Elm commit;
- exact Node 24.4.1 archive/binary SHA-256;
- public package seed SHA-256 and isolated overlay key;
- private package archive SHA-256;
- pinned `ws` 8.21.1 archive/source SHA-256, license, and dependency inventory;
- debug/optimized fixture artifact hashes;
- test command/result hashes where stable.

Cold-cache and warm-cache builds run. Archive reproduction runs twice. Artifact
gates fail on fixture observation symbols, absolute `/home` or harness release
paths, ambient `require("ws")`, undeclared dependencies, test hooks, source maps,
and non-package files. A positive-control fixture proves each grep/gate can fail.

Node matrix remains pinned 24.4.1 authoritative, latest reviewed 24.x drift gate,
22.x observation until promoted, and 20.x unsupported observation. Effective
slowloris knobs and event race traces are recorded per runtime.

## 14. Revised harness milestones

1. **M0a complete:** generated debug/opt bind/request/response/close path.
2. **M0b complete as host probe:** actual pre-listen cancellation; instrumented
   false-write/drain; exact-object pinned-`ws` upgrade transfer. Must be repeated
   through production-shaped generated manager fixtures before implementation
   acceptance.
3. **M1:** package-local broad HTTP manager, pure models, bounded exhaustive and
   real runtime tests, immutable provenance; no harness edit.
4. **M2:** private pinned-`ws` adapter packaged and tested offline, including
   exactly-once handoff and upgraded-connection close. No public WebSocket API.
5. **M3:** frozen harness differential branch moves the sole listener as one
   unit. Ordinary HTTP and upgrade both originate from package ownership; there
   is never split listener authority.
6. **M4:** daemon liveness parity: endpoint only after listen, sole external
   `daemon.json` writer, `ready` only after Hello, cleanup on every close path.
7. **M5:** PortLink/identity/reconnect/restart/full harness suites and format;
   evidence branch pushed, never deployed.
8. **Separate WebSocket feature:** new feasibility/reviews/properties before any
   public message/connection API replaces pinned `ws`.

Rollback restores the old `wire.js` HTTP + upgrade listener together. If the
private adapter cannot be packaged without ambient dependency or raw-socket
exposure, M3 is blocked; the design does not permit a partial HTTP-only listener
migration.

## 15. Resolution table

| Review rejection | Revision |
|---|---|
| blocking `onEffects` | dispatch + registry; long completion only via `SelfMsg` |
| lifecycle/routing ambiguity | commands own lifecycle; subscriptions are current generation-tagged routes |
| no feasible harness upgrade | exact-object, exactly-once private pinned-`ws` adapter spike and gate |
| only local limits | hard + global + listener budgets with atomic reservation/release |
| missing deadlines | complete parser/decision/body/write/keepalive/upgrade/close table |
| vague over-limit policy | precise 413/discard/destroy/reuse rules |
| vague parser semantics | strict Node parser, raw headers/trailers, framing/Expect/CONNECT rules |
| abort/completion conflation | explicit event precedence and `AcceptedByNode` naming |
| unmeasured backpressure/cancel | real counts/max buffer and real pre-listen cancellation probe |
| absent subscriptions | no backlog; immediate bounded fallback; stale generation rejection |
| weak provenance/tests | pinned `ws`, manifest/artifact gates, bounded exhaustive models |
| WebSocket scope confusion | HTTP upgrade bridge only; public WebSocket remains separate |

Round A issues are closed at design level. Independent review B must challenge
this revision before production implementation.
