# 01 — `schelm-node-http-server` broad v1 design

Status: first-turn design only. No production implementation is authorized by
this artifact. Independent hostile reviews, revisions, and the property plan
must precede implementation.

## 1. Goal, first harness milestone, and boundaries

Broad v1 is a Node-only Elm package for bounded HTTP/1.1 server mechanics:
validated loopback/public TCP binds, one owned listener, streamed bounded
request bodies, response head/body completion with backpressure, upgrades as
explicit offers, connection lifecycle facts, and graceful close.

The first harness milestone is narrower: replace the cockpit's loopback HTTP
listener and ordinary HTTP request handling while keeping existing `ws`
upgrade handling behind an adapter. The package must preserve these harness
invariants:

- one HTTP listener serves cockpit assets, protocol upgrade, and PortLink;
- bind loopback unless hosted Unix-socket integration remains in legacy code;
- no `daemon.json` before successful listen, and one external liveness writer;
- `ready` is an application fact after the first service-level Hello, not a
  synonym for listening;
- close removes the liveness file on every application exit path;
- verified identity headers arrive as facts; trust and authorization remain
  router/application policy;
- PortLink still proxies HTTP and upgrade traffic to registered loopback ports.

The package does **not** own daemon files, readiness, routes, static assets,
identity trust, PortLink lookup/rewrite, sessions, protocol JSON, or process
exit. Those remain ordinary Elm/harness boundary code.

V1 non-goals: TLS termination, HTTP/2/3, reverse proxy policy, filesystem
serving, cookies/sessions, compression, CORS, routing, multipart parsing,
automatic JSON, unbounded bodies, raw socket escape hatches, and WebSocket
protocol claims without the separate gate in section 10.

Target: pinned Schelm Elm 0.19.2 fork, Node 24.4.1, Linux x86_64. Other Node
versions require an explicit matrix result, not hopeful semver prose.

## 2. Mental model

A server has one listener and many exchanges. Elm subscribes to incoming
exchange events, pulls request body chunks one at a time, and sends exactly one
terminal response. Closing first stops acceptance, then drains or force-closes
owned connections according to an explicit plan.

```text
Absent -- listen --> Starting -- listening --> Open -- close --> Draining --> Closed
                        | error                  | fatal             | deadline
                        v                        v                   v
                      Absent                  Failed              Closed

Exchange:
AwaitingDecision --> ReadingRequest <--> AwaitingRead
        |                 | EOF/error/cancel
        +-------------> RespondingHead --> WritingBody <--> AwaitingDrain
                                               | end/error/peer close
                                               v
                                            Terminal --> Absent
```

A listener token identifies cooperative manager ownership; it is not a network
security capability. A public bind makes the process reachable according to OS
and network configuration. The types prevent accidental public binding, not a
malicious linked package from asking for one.

## 3. Proposed modules and public shape

Names remain reviewable, but ownership and boundedness may not be weakened.

```elm
module Schelm.Node.HttpServer exposing
    ( Permission, initialize
    , Bind, BindError, loopback, public, port, ephemeralPort
    , Options, defaults, withRequestHeadLimit, withIdleTimeout
    , Listener, Endpoint, listenerId, endpoint
    , ListenError, ListenErrorKind(..), listenErrorKind, listenErrorMessage
    , listen, onEvent, Event(..)
    , Request, RequestId, requestId, method, target, httpVersion
    , Header, headers, headerValues, remoteAddress
    , BodyReader, BodyLimit, bodyLimit, BodyEvent(..), readBody, discardBody
    , Response, Status, status, HeaderError, response, withHeader
    , ResponseBody, empty, utf8, bytes, stream
    , Writer, WriteEvent(..), write, end
    , AbortReason(..), abort
    , ClosePlan, graceful, withDeadline, CloseReport, close
    )
```

Sketch only:

```elm
type Permission                     -- Init-issued cooperative module permission

type Bind                           -- opaque validated bind intent
loopback : Port -> Bind             -- exactly 127.0.0.1 for v1
public : PublicAcknowledgement -> Port -> Bind
port : Int -> Result BindError Port -- 1..65535
ephemeralPort : Port                -- host chooses, mainly tests/dev

type PublicAcknowledgement          -- explicit constructor with alarming name
acknowledgePublicExposure : PublicAcknowledgement

type Listener                       -- opaque manager id
type alias Endpoint = { host : String, port_ : Int }

type Event
    = RequestReceived Listener Request BodyReader Response
    | UpgradeOffered Listener Upgrade
    | RequestAborted Listener RequestId AbortReason
    | ListenerFailed Listener RuntimeError

type Request                        -- immutable head facts; body excluded
type BodyReader                     -- one live body cursor
type BodyEvent = BodyChunk BodyReader Bytes | BodyComplete | BodyFailed BodyError
readBody : BodyReader -> Cmd msg     -- delivered through callbacks supplied at listen

type Response                       -- exclusive response authority for one exchange
response : Response -> Status -> List Header -> ResponseBody -> Cmd msg

type ResponseBody = Complete Body | Streaming
stream : Response -> Status -> List Header -> Cmd msg

type Writer                         -- emitted when streaming head is accepted
type WriteEvent = WriteAccepted Writer | WriteDrained Writer | WriteFailed WriteError
write : Writer -> Bytes -> Cmd msg
end : Writer -> Cmd msg
abort : Response -> AbortReason -> Cmd msg

close : Listener -> ClosePlan -> (Result CloseError CloseReport -> msg) -> Cmd msg
```

The exact callback record will be refined to avoid ambient global event
subscriptions and to make `Cmd.map` lawful. Proposed listen callbacks:

```elm
type alias Callbacks msg =
    { onListening : Result ListenError Listener -> msg
    , onRequest : Listener -> Request -> BodyReader -> Response -> msg
    , onUpgrade : Listener -> Upgrade -> msg
    , onRequestAborted : Listener -> RequestId -> AbortReason -> msg
    , onListenerFailed : Listener -> RuntimeError -> msg
    , onBody : RequestId -> BodyEvent -> msg
    , onWrite : ResponseId -> WriteEvent -> msg
    }

listen : Permission -> Bind -> Options -> Callbacks msg -> Cmd msg
```

A later revision may split callbacks into subscriptions if the generated
manager model demonstrates simpler lawful reconciliation. It may not make the
listener's lifetime depend on a subscription disappearing.

## 4. Bind types: safe default, honest public exposure

`loopback` constructs exactly IPv4 `127.0.0.1`; it does not silently include
IPv6, localhost DNS, Unix sockets, or wildcard addresses. IPv6 loopback can be
a later explicit constructor. `public` binds `0.0.0.0` only after the caller
passes a loudly named acknowledgement. Arbitrary host strings are absent in v1.

This is MISI for accidental exposure:

```text
Bind = Loopback Port | Public PublicAcknowledgement Port
```

No `{ host : String, public : Bool }`, no contradictory flags, no implicit
fallback from failed loopback to wildcard. `port 0` is rejected; tests ask for
`ephemeralPort`, so production config cannot accidentally advertise zero.
The actual selected endpoint comes only from Node's `server.address()` after
`listening`.

Unix-domain sockets are useful to hosted harness deployment but need path
ownership/cleanup/permissions and filesystem interaction. They are an explicit
post-v1 addendum or remain in the legacy listener during the first milestone;
they must not be disguised as a host string.

## 5. One listener fact and ownership

The manager registry is the sole in-process authority:

```text
Dict ListenerId ListenerState
ListenerState
  = Starting BindAttempt
  | Open OpenResources
  | Draining DrainResources
```

Settled listeners are absent. `Listener` ids are unforgeable through the public
API but cooperative, not security capabilities. Ids are monotonic up to the
safe JS integer bound and skip live keys after wrap. Kernel JS never decodes
optimized Elm constructors; ordinary Elm unwraps tokens to primitive ids.

The registry owns the Node server, all accepted sockets, active exchanges,
pending body reads, response cursors, timers, and callback router. Node objects
never enter Elm values. Every callback re-checks id + generation-free live
membership; stale callbacks observe absence and do nothing. We do not need an
epoch because ids are not reused while live and terminal entries are deleted.

Subscription/callback replacement updates routing only. It never creates a
second Node server or closes the existing one. There is no separate `isOpen`
boolean, listener list, or application-maintained socket registry.

## 6. Request heads, headers, bodies, and connection facts

### Request head

`Request` is immutable copied data: id, validated method token, raw request
target, HTTP version, ordered duplicate-preserving headers, remote address
fact, and whether Node marked the connection encrypted (normally false in v1).
The package does not parse origin-form targets into a trusted absolute URL;
`Host` can be absent or hostile. Routing and proxy interpretation are policy.

Headers preserve duplicates and arrival order. Header names are normalized
ASCII lower-case for lookup, while values are copied strings. We do not use a
`Dict String String` like Gren because it destroys duplicates such as
`set-cookie` and can hide smuggling-relevant facts. Node's parsed and raw
header facts may both be retained in a bounded representation after review.

### Identity facts, not policy

`X-Harness-Email`, `X-Harness-User`, `X-Harness-Cf-Jwt`, and
`X-Harness-Cf-Zone` are ordinary header values. The package neither strips,
injects, verifies, prefers, nor labels them authenticated. PortLink/router
boundaries own spoof stripping and JWT verification. Application helpers may
read headers by name but must return facts, never an `Identity` capability.

### Request bodies

Bodies are pull-driven and capped. Options require a positive per-request head
limit, body limit, idle timeout, and maximum active exchanges, each below a
package hard maximum. Node `IncomingMessage` is paused before delivery. One
`readBody` command permits at most one chunk event; no second physical read is
armed until the prior `sendToApp` task has crossed its callback and the caller
asks again.

```text
Paused -> ReadPending -> DeliveringChunk -> Paused
   | EOF/error/limit/discard                   |
   +---------------------> Terminal ----------+
```

At most `limit + one transport chunk` is transiently visible to JS, and only
one copied chunk crosses to Elm. Crossing the limit emits `BodyTooLarge`,
destroys or drains according to reviewed connection-safety rules, and cannot
later emit complete. `discardBody` drains under the same cap/timeouts; it is
not an unbounded sink.

## 7. Responses, completion, and backpressure

A response authority is exclusive by manager invariant. First terminal intent
claims it; duplicate `response`, `stream`, `end`, or `abort` commands are
idempotent stale operations and cannot write twice.

Buffered responses have a package hard maximum. Streaming responses make
backpressure explicit:

```text
Ready
  -- write(chunk), Node true  --> Deliver WriteAccepted -> Ready
  -- write(chunk), Node false --> WaitingDrain
WaitingDrain
  -- drain ------------------> Deliver WriteDrained -> Ready
  -- error/close ------------> Terminal failure
Ready
  -- end --> Ending -- finish --> Terminal success
```

Only one write may be outstanding. `write` copies/retains one bounded chunk,
uses a cursor for partial fixture-injected writes, and stops immediately on
`false`. The manager does not queue an unbounded list and does not send
accumulated output back to Elm. `finish` means Node accepted the response into
its output path; it does not claim the peer received bytes. `close` before
`finish` is a distinct `PeerClosed` result.

Header validation rejects control characters, invalid tokens, forbidden
connection-specific combinations, and body/status contradictions before any
physical write. HEAD and statuses 1xx/204/304 cannot accidentally send a body.
Node may enforce additional external constraints, classified constructively.

## 8. Graceful close and connection lifecycle

`close listener plan` atomically changes `Open` to `Draining` before calling
Node. New acceptance stops once `server.close()` is dispatched. Existing HTTP
exchanges and upgraded connections are tracked by the same listener registry.

```text
Open
  -- close --> Draining(no new requests, deadline, live connection set)
Draining
  -- all exchanges/connections terminal --> Absent + CloseReport Graceful
  -- deadline --> closeIdleConnections; destroy remaining owned sockets
              --> Absent + CloseReport Forced(counts)
```

Repeated close joins the same close result; it does not create competing timers
or report `NotFound`. A close deadline is mandatory and capped. `CloseReport`
contains facts (completed exchanges, forced HTTP sockets, forced upgrades), not
policy conclusions. Fatal listener errors move to draining/absent through the
same cleanup path and emit one terminal event.

Connection facts are minimal: accepted, remote address, HTTP active/idle,
upgraded, closed. Raw `net.Socket` is never public. This supports honest drain
and observability without exporting unbounded socket authority.

## 9. Friendly constructive errors

Host exceptions are never exposed or sanitized into success values. The kernel
maps known codes/events at the site where they occur; unknowns become a stable
fallback with a phase, never a stack trace.

```elm
type ListenErrorKind
    = AddressInUse
    | AddressUnavailable
    | PermissionDenied
    | ResourceExhausted
    | UnsupportedRuntime
    | UnknownListenFailure

type BodyErrorKind
    = BodyTooLarge | BodyTimedOut | MalformedTransfer | PeerAborted | BodyFailure

type WriteErrorKind
    = InvalidResponse | PeerClosed | WriteTimedOut | ResponseAlreadySettled | WriteFailure

type CloseErrorKind
    = ListenerAlreadyGone | CloseFailure
```

Public error records expose `kind`, `phase`, and a package-authored recovery
message. Example: `AddressInUse` says “Choose another port or close the process
already listening.” Raw addresses, arbitrary exception messages, JWT/header
values, response bodies, and stack traces are absent. Programmer mistakes that
can be prevented by constructors are not runtime errors.

## 10. HTTP upgrade and WebSocket split

`UpgradeOffered` is part of HTTP v1 because a sole listener must decide the
upgrade path. The opaque offer owns request-head facts, socket, and `head`
bytes until exactly one action: reject with an HTTP response, hand to a
registered protocol adapter, or allow its short deadline to reject/close.
There is no public raw socket.

`Schelm.Node.WebSocketServer` is conditionally designed, not claimed feasible
by this artifact. It requires its own pinned/audited implementation and tests
for RFC 6455 handshake, masking, fragmentation, control frames, UTF-8, close,
message caps, ping/pong, and backpressure. If admitted, it will consume an
`Upgrade` through an internal package-only bridge and expose:

```text
UpgradeOffer -> Accepting -> Open -> Closing -> Closed/Absent
Open: one bounded delivered message at a time; one bounded send in flight;
      close handshake deadline; terminal event exactly once.
```

Until that gate passes, the harness milestone uses a narrow adapter to the
already pinned `ws` package or leaves `wire.js` upgrade ownership intact. We do
not publish a `WebSocketServer` module that merely wraps raw sockets or ignores
protocol obligations.

## 11. Gren comparison matrix

Compared source: `gren-lang/node` 6.1.3.

| Concern | Gren `HttpServer` | Schelm broad v1 |
|---|---|---|
| Permission | `Init.Task Permission` | Same cooperative initialization concept |
| Bind | arbitrary `{ host, port_ }` strings | opaque `Loopback` / explicit `Public`; validated port |
| Listener | opaque `Server` returned by `Task` | opaque manager-owned listener with endpoint and lifecycle |
| Requests | subscription; buffers full body before event | head delivered promptly; pull-driven bounded body |
| Headers | `Dict String String` | ordered duplicate-preserving bounded headers |
| Response | status/headers + whole String/Bytes; `end()` | buffered or streaming; explicit completion and failure |
| Backpressure | `write` return ignored | one write in flight; `false`/`drain` state machine |
| Completion | no acknowledgement to app | result after `finish`/error/close classification |
| Close | absent | mandatory-deadline graceful/forced close report |
| Connections | hidden and untracked publicly | registry facts sufficient for drain; no raw socket |
| Upgrade | absent | exclusive bounded upgrade offer |
| WebSocket | absent in pinned package | separate feasibility/review gate |
| Errors | raw Node code/message | stable kind/phase/recovery message |

We keep Gren's teachable TEA/event shape but do not copy its unbounded request
buffer, lossy headers, raw host strings, missing close, or ignored writable
backpressure.

## 12. MISI, MITI, DRY, and authority inventory

### Invalid combinations made unrepresentable

- loopback and public cannot both be selected;
- ephemeral and fixed ports are different constructors;
- no response can carry two body representations;
- status/body contradictions fail construction before effects;
- a request head cannot contain a half-created body stream;
- a response is claimed once in the registry;
- `Open` and `Draining` are constructors, not booleans;
- terminal listener/exchange/upgrade entries are absent;
- one body read and one response write can be in flight;
- upgrade rejection and protocol handoff are exclusive;
- graceful and forced closure are phases of one close operation.

Elm cannot statically consume opaque tokens linearly. The manager registry is
the one dynamic authority for exactly-once transitions; generated command
sequence tests must prove stale-token behavior.

### MITI

The package scopes accidental authority: no arbitrary host, no raw socket, no
ambient global listener, bounded bodies/writes, explicit public exposure. It is
not a sandbox. Any linked code holding `Permission` can request a public
listener and any code with a live token can cooperate or interfere. OS users,
firewalls, reverse proxies, and router verification remain security boundaries.

### DRY

- one registry owns listeners, exchanges, connections, upgrades, and timers;
- one header validator is used for request facts and response construction as
  applicable;
- one close ladder handles explicit close, fatal error, and shutdown adapter;
- one Node-code classifier maps errors by phase;
- one production kernel is exercised by models; fixture hooks are generated
  variants, not a second implementation;
- daemon liveness and identity trust remain each in their existing single
  harness authority, never duplicated in this package.

## 13. Complexity and memory budgets

Hot event work is O(new chunk/header/write), never O(conversation, all
listeners, prior stream bytes, or all historical requests).

- listener lookup: `Map`/`Dict` O(1) average in JS registry;
- exchange/response lookup: O(1) average;
- body event: O(chunk bytes) copy, one chunk retained;
- write event: O(chunk bytes), one chunk/cursor retained;
- headers: O(header count + bytes) once, under explicit caps;
- connection accept/close: O(1);
- graceful terminal completion: O(1) per connection; forced deadline may be
  O(current live connections) once, a cold terminal path;
- subscription reconciliation: O(current declared listeners), cold per TEA
  effects wave; no scanning requests or connections;
- no `acc ++ [ x ]`, whole-record `List.member`, history fingerprints, or
  accumulated-buffer callbacks.

At request 1,000 and chunk 10,000, cost depends only on the current bounded
head/chunk and registry lookup. At listener 200, events do not scan 200
listeners. Hard defaults/proposed maxima will be finalized after measured
fixtures (candidate: 32 KiB heads, 8 MiB buffered body/response, 256 KiB stream
chunk, 10k active exchanges package maximum).

## 14. Property/reference models and failure injection

`06-property-test-plan.md` will specify full gates. Required model families are
already fixed:

1. **Listener model:** generated listen/error/close/deadline/stale-callback
   sequences; one physical listener and one terminal result.
2. **Exchange model:** request, body reads, limit crossing, response race,
   peer abort; no event after terminal and no leaked registry entry.
3. **Writer model:** arbitrary `write` true/false, drain/error/close/finish;
   byte order preserved, one pending chunk, no write while blocked.
4. **Close model:** accepted HTTP/upgraded connections, idle/active changes,
   deadline; acceptance stops and terminal report counts partition ownership.
5. **Upgrade model:** reject/handoff/timeout/duplicate commands; exactly one
   consumer and preservation of initial `head` bytes.
6. **Header model:** arbitrary bytes/duplicates/casing; deterministic validation
   and lookup without collapsing semantically distinct fields.
7. **Debug/opt differential:** identical observable traces from real generated
   workers; production artifact free of fixture names/hooks.
8. **Node differential:** package path versus frozen direct Node fixture for
   bind failures, body chunks, finish, drain, peer close, and graceful close.
9. **Harness differential:** old `wire.js`/cockpit listener versus package
   adapter for HTTP routes and daemon lifecycle, then existing `ws` upgrade.

Injected sites include synchronous throws, event reorderings allowed by Node,
request abort between callbacks, response close before finish, never-draining
writes, timeout races, duplicate commands, listen error after setup, and
application callback/task cancellation. Bounded exhaustive traces precede
random long runs.

## 15. Node compatibility matrix

The authoritative release target is pinned Node 24.4.1. CI must run real debug
and optimized fixtures on:

| Node | Purpose | Claim |
|---|---|---|
| 24.4.1 pinned | release authority | required, exact |
| latest 24.x approved in lock update | drift warning/gate after review | no claim until green |
| 22.x LTS | compatibility observation | supported only if all required APIs/semantics pass |
| 20.x | negative/compat observation | no support promise in v1 |

Matrix tests feature-detect `closeIdleConnections`, connection tracking, abort
semantics, and writable events. Missing required behavior fails as
`UnsupportedRuntime`; it never silently downgrades graceful guarantees. The
package archive and compiler/Node provenance follow accepted filesystem/HTTP
package patterns with immutable hashes and isolated cache.

## 16. Harness daemon-wire milestones

1. **M0 feasibility (this commit):** real debug/opt listener, request, 4 MiB
   backpressured response, finish, idempotent close.
2. **M1 package-local HTTP:** production manager + models, no harness edit.
3. **M2 cockpit HTTP adapter:** package owns exactly one loopback listener and
   ordinary requests; existing WebSocket/PortLink upgrade remains adapter-owned.
4. **M3 liveness parity:** listener success emits endpoint; ordinary Elm/host
   keeps sole `daemon.json` writer. Tests prove no file before listen, correct
   endpoint, cleanup on close, and `ready` changes only after Hello.
5. **M4 upgrade bridge:** package upgrade offer hands to pinned existing `ws`
   adapter without opening a second listener; PortLink paths and recovered
   upgrade routes remain behaviorally identical.
6. **M5 full wire cutover:** only after frozen old/new traces, all harness suites,
   format, restart/recovery, and PortLink identity tests pass. No deploy from the
   evidence branch.
7. **M6 optional WebSocket module:** separate feasibility/reviews; replace `ws`
   adapter only if it is demonstrably broader and safer, not merely more Elm.

Rollback at every integration milestone restores the old listener as one unit;
there is never a mode with two authorities bound to the daemon endpoint.

## 17. Open decisions for hostile review

- callbacks stored at `listen` versus subscriptions reconciled by listener id;
- exact response builder shape that best models HEAD/1xx/204/304;
- whether accepted bodies should be drained or connections destroyed after
  application rejection, under keep-alive safety;
- Unix-socket addendum scope for hosted harness mode;
- exact hard limits and deadline defaults from measured memory/load fixtures;
- package-internal protocol-adapter mechanism that does not expose raw sockets;
- whether Node 22 earns support after the real matrix;
- whether WebSocket uses a pinned `ws` artifact or an audited internal codec.

None of these may be resolved by weakening one-listener ownership,
boundedness, constructive errors, or the explicit WebSocket feasibility gate.
