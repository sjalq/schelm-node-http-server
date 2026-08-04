# schelm-node-http-server

A bounded, cooperative HTTP/1.1 server for Schelm programs running on Node.js.

```elm
HttpServer.listen HttpServer.initialize (HttpServer.loopback HttpServer.ephemeralPort) HttpServer.defaults { onStarted = Started, onFinished = Listening }
HttpServer.onEvents (HttpServer.eventRoute listener 1) GotHttp
-- Keep the numeric route owner stable while this handler is the same logical subscription.
HttpServer.send response (HttpServer.text 200 "hello") Sent
HttpServer.close listener HttpServer.graceful Closed
```

The listener owns network resources until `close` settles. Request bodies are
pull-driven. A delivered chunk retains its byte reservation only until the next demand/discard or the bounded body deadline; expiry destroys the paused connection and releases ownership. Streaming writes retain one chunk and honor Node backpressure.
`AcceptedByNode` means the response emitted `finish`; it does not mean the peer
received or persisted bytes. Public binding requires an explicit acknowledgement.
All limits and waiting states are bounded. Each effects wave admits at most 1024 commands and at most 4096 one-shot replies remain pending; excess commands receive typed overload results. Terminal listener close is the quiescent boundary that prunes its route generation tombstone; listener identities are never reused, so late facts remain stale without retaining sequential churn history. See module docs for recovery errors.

WebSocket messages are deliberately not public API. Version 1.1 adds typed Unix-domain binding and two deliberately narrow migration commands, `transferRequest` and `transferUpgrade`. They synchronously offer the already-owned Node request/response or upgrade tuple to `globalThis.__schelmHttpLegacyTransfer`; the adapter returns `true` only after assuming lifecycle ownership. Rejection keeps request ownership available for another decision, while a rejected/malformed upgrade is destroyed and released. Successful transfer is exact-once and removes package ownership before Elm observes `Transferred`. This bridge exists to preserve established HTTP and WebSocket policy adapters while Schelm remains the sole listener authority; it is not a general raw-socket API.

The package-private, offline-pinned `ws` upgrade bridge remains available for package tests and migration adapters. A transferred upgrade remains kernel-owned until the adapter synchronously adopts it; malformed/rejected transfers and transfers that never settle are destroyed and released exactly once.

## Guarantees and limits

- Admission reserves listener, connection, exchange, request-copy, response-copy,
  and upgrade capacity before package retention.
- Request bodies are paused until `readBody` or `discardBody`; one body operation
  may be pending at a time and every wait has a deadline.
- Streaming permits one physical write in flight. `WriteDrained` means Node
  emitted `drain`; cumulative response bytes remain bounded by `responseBytes`.
- Concurrent HTTP/1.1 pipelining is rejected. Sequential keep-alive is bounded
  by `requestsPerSocket`.
- Graceful close stops admission, closes idle sockets, waits for active work,
  then destroys leftovers at its deadline and reports completed/rejected/forced.
- This package does not claim peer delivery, TLS termination, HTTP/2, or a
  public WebSocket API.

`npm test` is the release gate: kernel assembly, isolated offline debug/optimized
Elm builds, model/runtime/fault/scale suites, artifact contamination checks,
deterministic `ws` archive reproduction, and pinned toolchain provenance.
