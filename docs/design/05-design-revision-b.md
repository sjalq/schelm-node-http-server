# 05 — Final design revision B

Status: final design gate. This supersedes conflicting details in revisions A
and the initial design. Implementation follows only after M0c and the property
plan are executable.

## 1. Lawful manager routing

`SelfMsg` is closed over package facts and never parameterized by application
messages:

```elm
type SelfMsg
    = Bound OperationId (Result ListenError ListenerFacts)
    | Wrote OperationId WriteFact
    | Closed OperationId CloseFact
    | Incoming ListenerId RouteGeneration RequestFacts
    | Upgraded UpgradeId UpgradeFact

type alias State msg =
    { replies : Dict OperationId (Reply msg)
    , routes : Dict ListenerId (Route msg)
    }

type Reply msg
    = ListenReply (Result ListenError Listener -> msg)
    | WriteReply (Result WriteError WriteResult -> msg)
    | CloseReply (Result CloseError CloseReport -> msg)
```

`cmdMap` composes each command reply before admission. `onEffects` inserts that
reply in `State msg`, dispatches a kernel verb carrying only operation/listener
ids, and returns promptly. Kernel callbacks send primitive facts to `SelfMsg`.
`onSelfMsg` finds and **removes** the matching reply before `sendToApp`. Unknown
or duplicate operation ids are stale cleanup. Kernel JS never stores or invokes
an application tagger. This is the only reply authority.

## 2. Stable current subscription ownership

`onEvents listener tagger` is current routing, not lifecycle. Reconciliation
groups subscriptions by listener id:

- zero: remove route and increment the listener's route generation once;
- exactly one while previously present: retain generation, replace only mapped
  tagger (so ordinary TEA reconciliation does not stale admitted events);
- exactly one after absence: increment generation and install route;
- more than one: mark listener route `Ambiguous`, increment once on transition,
  reject all unsolicited network events with bounded fallback, and emit one
  coalesced `DuplicateSubscription` diagnostic through command/query tooling.

Duplicate subscriptions never first/last-win. Returning to exactly one creates a
new generation. `Incoming` carries generation captured at reservation; delivery
requires a present current route with equal generation. No generic backlog.

## 3. One budget authority

Kernel-private `Budget` is the sole mutable authority. It owns hard/global and
per-listener limits and mints monotonic `ReservationId`s:

```text
reserve(listener, class, amount) -> ReservationId | Exhausted
release(ReservationId) -> Released | Stale
```

Every package-retained listener/socket/exchange/body copy/write chunk/upgrade/
self-fact stores reservation ids. Reservation occurs before package registry
retention or byte copying. It cannot precede Node/libuv's own parser/socket
allocation, so no stronger claim is made. Failed reservation immediately rejects
or destroys the already-present external object without retaining it. Release
removes ids and derives totals; there are no independently mutable counters in
Elm. Elm receives immutable usage snapshots for diagnostics/tests only.

The rejection reserve is a separate budget class normal work cannot consume.
Reservation ids are never reused while live; terminal absence consumes all ids
exactly once. Global/listener totals are derived from the reservation map in
cold diagnostics, while hot admission uses indexed class counters updated only
by reserve/release in the same authority.

## 4. Explicit pipelining policy

V1 supports HTTP/1.1 keep-alive but **rejects concurrent pipelining**. Per socket:

```text
Idle -> Active(exchange)
Active + another request event -> Overflow
Overflow: mark non-reusable; fixed 429/503 only if response ordering is safe,
otherwise destroy socket; no second RequestOffered reaches Elm.
Active reaches body EOF + response finish + safe discard -> Idle
```

Node may already have parsed the second head; the package retains none of its
body and destroys after the active response's bounded finish opportunity. There
is no application queue, so pipelining count and retained queue bytes are both
zero. `maxRequestsPerSocket` still bounds sequential reuse. Raw-socket tests send
two requests in one write and verify only the first is delivered, ordering is
not inverted, memory is bounded, and the connection closes deterministically.
A future bounded queue is a separate design.

## 5. M0c gate

Before production modules are authored, generated debug and optimized workers
must exercise the production manager shape from section 1:

1. dispatch listen, cancel before `listening`, receive primitive cancellation
   self fact, prove no success reply and port reuse;
2. script the kernel writer to return false at chosen writes, assert exactly one
   write retained, no write while blocked, drain resumes in byte order, and real
   paused-client run records positive false/drain counts;
3. send raw upgrade request plus deliberate bytes after headers so Node supplies
   non-empty `head`; private registry proves byte-for-byte identity on exactly-
   once transfer to offline pinned `ws`;
4. separate upgrade offers cover bounded HTTP rejection and decision timeout,
   both releasing reservations and destroying sockets;
5. all observable traces and fixture golden JSON match debug vs optimize.

Host probes already establish the primitives but do not satisfy M0c alone.
Fixture instrumentation is mechanically absent from production assembly.

## 6. HTTP surface and deadlines

The final broad v1 keeps revision A's strict Node parser, duplicate-preserving
bounded `rawHeaders`/`rawTrailers`, raw target classification, framing checks,
CONNECT/Expect rejection, pull body, exact body-limit/discard policy, one write
in flight, finish/close precedence, graceful close, and explicit
loopback/public binds.

All options are validated opaque values with no unbounded constructor. Before
listen the package sets `headersTimeout`, `requestTimeout`, `keepAliveTimeout`,
`keepAliveTimeoutBuffer`, `maxHeadersCount`, and `maxRequestsPerSocket`; missing
required Node support is `UnsupportedRuntime`. Manager-owned decision, body
progress/discard, write/drain, finish, upgrade decision/handshake, bind, and close
deadlines have hard caps and terminal cleanup. Slowloris protection is tested at
raw socket/parser level, not inferred from application timers.

Body policy remains:

- declared over-limit: fixed 413 + close, no body retention;
- streaming crossing limit: no over-limit chunk to Elm, never drain remainder,
  413 if safe then destroy;
- explicit/automatic discard: only under separate byte and progress caps; valid
  EOF permits reuse, otherwise destroy;
- malformed framing/trailers or client abort: never reuse.

Response `finish` means accepted by Node only. `close` before finish is
`PeerClosed`; close after finish is connection lifecycle. Late facts cannot
create a second terminal result.

## 7. Private offline `ws` bridge

`ws` 8.21.1 is stored as a deterministic offline archive with normalized paths,
mtime/uid/gid and SHA-256, metadata and MIT license provenance. Build/test
extract into isolated package state; ambient `require("ws")` is forbidden.
Optional native `bufferutil` and `utf-8-validate` are absent; tests require the
pure-JS fallback. Archive reproduction and extraction digest are gates.

The private adapter accepts only package-owned upgrade reservation ids. Claim
atomically consumes the offer before passing the exact `req/socket/head` to one
compiled-in `WebSocketServer({ noServer:true })`. Reject/timeout/duplicate are
terminal. It is inaccessible from public Elm API and cannot register arbitrary
foreign callbacks. Public WebSocket connection/message support remains deferred.

## 8. Evidence, audit, and rollout

The pure transition model and production manager share state constructors and
transition functions where Elm permits. A conformance runner executes canonical
traces against model and generated boundary. Golden trace counts and SHA-256
digests are checked files; test-alphabet/pruning changes require an explicit
reviewed golden update, never auto-refresh during test.

Implementation order:

1. M0c generated evidence;
2. production broad HTTP package;
3. bounded exhaustive/model conformance, runtime, performance, debug/opt,
   archive/provenance/artifact tests;
4. self-audit against MISI/MITI/DRY, Big-O, errors, and all review findings;
5. package commit/push;
6. only then a separate harness integration evidence branch.

No harness files are edited before package audit. No deployment occurs from an
integration branch. Rollback always restores old HTTP+upgrade listener as one
unit.
