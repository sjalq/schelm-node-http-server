# schelm-node-http-server

A bounded, cooperative HTTP/1.1 server for Schelm programs running on Node.js.

```elm
HttpServer.listen HttpServer.loopback HttpServer.defaults Listening
HttpServer.onEvents listener GotHttp
HttpServer.send response (HttpServer.text 200 "hello") Sent
HttpServer.close listener HttpServer.graceful Closed
```

The listener owns network resources until `close` settles. Request bodies are
pull-driven. Streaming writes retain one chunk and honor Node backpressure.
`AcceptedByNode` means the response emitted `finish`; it does not mean the peer
received or persisted bytes. Public binding requires an explicit acknowledgement.
All limits and waiting states are bounded. See module docs for recovery errors.

WebSocket messages are deliberately not public API. A package-private,
offline-pinned `ws` upgrade bridge exists for migration adapters only.

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
