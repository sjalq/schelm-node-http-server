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
