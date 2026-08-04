# HTTP server v1 release audit

Date: 2025-08-06. Authority runtime: pinned Node 24.4.1.

## Five principles

1. **Ergonomic API:** opaque ports, binds, options, limits, listeners, readers,
   responses, writers, and upgrades; safe text/bytes helpers; explicit public-bind
   acknowledgement; recovery-oriented errors.
2. **Production boundary:** one Elm effect manager owns app taggers and reply
   routing. The generated kernel stores primitive facts and Node resources only.
   Reply entries are removed before delivery; subscription generations reject
   stale or ambiguous unsolicited work.
3. **Bounded ownership:** one reservation authority covers listeners,
   connections, exchanges, copied body/write bytes, and upgrades. Bodies are
   pull-driven, writes retain at most one chunk, and every waiting state ends by
   fact, deadline, or close.
4. **Honest transport semantics:** HTTP/1.1 keep-alive is sequential;
   concurrent pipelining is rejected. `AcceptedByNode` means `finish`, never peer
   delivery. Close-before-finish is peer closure. Graceful shutdown is bounded.
5. **Private migration adapter:** no public WebSocket message/socket surface.
   Upgrade offers are package-owned, exactly-once tokens. The only accepted
   adapter dependency is the checked offline `ws` 8.21.1 archive using its
   pure-JS fallback.

## Executable evidence

- M0c debug/optimized production-shaped fixture golden remains green.
- Production Elm fixture compiles offline in debug and optimized modes; both run
  real HTTP and normalize to the same trace digest.
- Bounded exhaustive model: 5,380,840 explored nodes, checked count and digest.
- Real Node tests cover duplicate request headers, pull bodies, `finish`, actual
  backpressure/drain over 4 MiB, pipelining rejection, slow headers, absent and
  timed-out decisions, exact non-empty upgrade `head`, and duplicate claim.
- Scale gate performs 10,000 indexed reserve/release operations across 200
  listeners with no retained reservations.
- Artifact, deterministic archive, and provenance gates reject ambient `ws`,
  fixture/path contamination, changed archives, licenses, or toolchains.

## Review map and residual scope

Reviews A/B findings are represented by design invariants or executable gates:
manager routing, generation-stable subscription ownership, one budget authority,
no pipelining queue, parser/deadline controls, body/write limits, terminal
precedence, bounded close, exact upgrade ownership, offline provenance, debug/opt
differential execution, and contamination checks.

The package does **not** provide TLS termination, HTTP/2, peer-delivery receipts,
a public WebSocket API, arbitrary socket access, or transparent concurrent
pipelining. Those are explicit non-goals, not silent fallbacks.

## Self-audit

- **MISI:** terminal resources are removed; stale ids cannot revive them. Opaque
  constructors prevent unbounded public configuration.
- **MITI/DRY:** canonical kernel source is assembled mechanically into the Elm
  kernel and hash-checked; no second hand-maintained production implementation.
- **Big-O:** hot admission and release use indexed maps/sets. No history scan,
  request-body accumulation, response accumulation, or application queue.
- **Errors/recovery:** invalid configuration fails before listen; runtime
  exhaustion rejects boundedly; deadlines destroy unsafe resources; close can
  be retried/joined within a bounded waiter limit.
- **Repository hygiene:** generated build/elm-stuff are ignored. No harness files
  or integration work are part of this branch.
