# 00 — Runtime feasibility: `schelm-node-http-server`

Status: first-turn evidence and boundary decision. This is not an implementation.

## Question and result

Can a private Elm 0.19.2 effect manager own a Node HTTP listener, deliver
request events into TEA, complete responses only after Node acknowledges
`finish`, close the listener, and respect writable backpressure in both debug
and optimized output?

**Yes, with one important architecture constraint:** the long-lived listener,
requests, responses, sockets, and pending writes must live in an effect-manager
kernel registry. A `Task` may establish or close a resource, but a completed
scheduler binding cannot own it. Subscription reconciliation must update
callbacks without recreating the Node listener.

The checked-in fixture is deliberately small and disposable. It is evidence,
not production code:

```sh
node fixtures/feasibility/scripts/run.cjs
```

It compiles and executes `Main.elm` with the pinned Schelm compiler in debug and
`--optimize`, opens a real loopback listener, sends a real request with a paused
client, writes 4 MiB while honoring `write() == false` / `drain`, waits for the
response `finish` event, and closes idempotently. Expected terminal summaries:

```text
{"mode":"debug",...,"closed":{"ok":true},"client":{"status":200,"bytes":4194304}}
{"mode":"optimize",...,"closed":{"ok":true},"client":{"status":200,"bytes":4194304}}
```

Fixture products under `fixtures/feasibility/build/` are ignored and must not be
published. Production assembly must mechanically reject fixture hooks.

## What the spike proved

1. **Bind:** a command can start `http.createServer()`, attach listeners before
   `listen`, and settle once on `listening` or the first pre-listen `error`.
2. **Request event:** the kernel can retain the Node `IncomingMessage` /
   `ServerResponse` pair by registry id and `rawSpawn (sendToApp ...)` through
   the manager router. This works in debug and optimize when Elm constructs are
   converted to primitive ids/records before crossing the kernel boundary.
3. **Response completion:** `res.end()` dispatch is not completion. The command
   settles only on `finish`, with `error`/`close` classified separately in the
   production design.
4. **Backpressure:** a bounded writer can stop immediately when `res.write`
   returns `false`, retain only the current chunk/cursor, and resume on `drain`.
   It need not accumulate prior output or poll `writableLength`.
5. **Close:** `server.close(callback)` can stop acceptance and settle after
   existing HTTP connections drain. Repeated close must be manager-idempotent,
   because `Cmd.batch` and stale application messages can issue duplicates.
6. **Subscription lifecycle:** subscriptions are transient declarations.
   Removing a request subscription cannot implicitly close a listener; the
   registry is the owner and `close` is the transition.
7. **Debug/opt ABI:** pattern matching on minifier-sensitive custom-type object
   layouts in kernel JS is unsafe. Public Elm code must unwrap opaque values
   into primitive ids and plain records before kernel calls. This is now a
   design rule, not a test workaround.

## Scheduler boundary found during the spike

The spike exposed a subtle, useful boundary: a scheduler binding's cancel
function may be invoked as its process is disposed after callback settlement.
Therefore the bind canceler may abort **only an unsettled bind attempt**. Once
`listening` has transferred the server into the manager registry, the binding
no longer owns the listener and its canceler must be inert. Otherwise a
successful `listen` can be followed by an accidental close.

Production ownership transition:

```text
BindingAttempt(server)
  -- error before listening --> Absent + ListenFailed
  -- listening -------------> Registry owns LiveListener; binding owns nothing
  -- task killed pre-listen --> server.close(); Absent
```

## WebSocket feasibility

Node core provides HTTP upgrade facts and raw duplex sockets, but it does **not**
provide a WebSocket protocol implementation. The harness currently uses the
pinned `ws` package and `WebSocketServer({ noServer: true })`, then calls
`handleUpgrade` from the sole HTTP server's `upgrade` event. A broad, correct
WebSocket API requires handshake validation, frame parsing, masking,
fragmentation, control-frame rules, UTF-8 validation, close handshakes, payload
caps, send backpressure, and peer failure handling.

The present repository has no pinned/offline `ws` artifact and the requested
first turn cannot honestly prove that entire protocol boundary. Therefore:

- HTTP listener/requests/responses are feasible for v1.
- HTTP **upgrade offers** and rejection/handoff facts are feasible in the same
  listener package.
- `Schelm.Node.WebSocketServer` is a **separate reviewed module/release gate**.
  It may join v1 only after a pinned dependency or audited protocol kernel has
  debug/opt fixtures and generated frame/interleaving tests.
- The HTTP API must reserve upgrade ownership cleanly, but must not expose a raw
  socket publicly or call an upgrade a WebSocket connection.

This split avoids shipping a misleading toy WebSocket server while preserving
the harness migration path.

## Evidence still required before implementation claims

The spike proves the runtime shape, not production correctness. Later gates
must cover request-body flow control, disconnect/error races, duplicate/stale
commands, response chunk cursors, graceful-close deadlines and force-close,
upgrade ownership, old-Node compatibility policy, memory bounds, and frozen
harness differential traces. Every production guarantee needs the reference
model/property plan in `06-property-test-plan.md`.

## Sources inspected

- Schelm server principles: `server-principles/CLAUDE.md` and `docs/PROGRAM.md`.
- Gren 6.1.3 `HttpServer`, `HttpServer.Response`, and
  `Gren.Kernel.HttpServer` from the pinned package cache. Gren buffers request
  bodies, provides one request subscription, sends one buffered response, and
  lacks close/backpressure/WebSocket lifecycle APIs; it is a useful baseline,
  not the v1 ceiling. No `WebSocketServer` module exists in that package.
- Harness `elm-pkg-js/wire.js`, `host/cockpit-http.js`,
  `elm-pkg-js/daemon-state.js`, `elm-pkg-js/port-link-http.js`, and associated
  wire/daemon/PortLink tests and docs.
- Accepted Schelm filesystem and HTTP-client design/fixture patterns: pinned
  toolchain, isolated overlay, constructive errors, lifecycle models,
  debug/opt execution, fixture stripping, bounded stream work.
- Node 24.4.1 core `http.Server`, `IncomingMessage`, `ServerResponse`, and
  writable-stream event semantics as exercised by the real fixture.

No claim here depends on unexecuted pseudocode. WebSocket feasibility is
explicitly narrowed where evidence is absent.
