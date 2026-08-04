# 04 — Adversarial review B

Verdict: **reject revision A until the following concrete defects are removed.**

## Blocking defects

1. **Reply routing is prose, not type-correct Elm.** `SelfMsg` cannot contain an
application `msg`, and kernel JS must not retain arbitrary application taggers.
The lawful shape is `State msg` containing manager-owned one-shot reply records,
keyed by operation id; `SelfMsg` carries only primitive ids/facts. `onSelfMsg`
looks up the reply, removes it before `sendToApp`, and invokes it once. `cmdMap`
maps replies when commands enter the manager. The generated production-shaped
fixture must compile in debug/optimize and prove this route.

2. **Subscription generations would invalidate live events every effects wave.**
TEA rebuilds subscriptions routinely. Incrementing generation on every reconcile
makes an admitted request stale even when the same logical listener remains
subscribed. Route ownership must remain stable across consecutive waves with
exactly one subscription for a listener, while replacing only the current mapped
tagger. Generation changes only across absent/invalid to present boundaries.
Duplicate subscriptions for one listener must have one deterministic policy;
last-wins is rejected because `Sub.batch` ordering should not silently select
network authority.

3. **Two budget authorities are implied.** Mirrored counters in Elm and JS can
drift. One production authority must mint reservation ids before package
retention. Every retained Node object/chunk references reservations, and release
consumes those ids once. Elm receives budget facts, not a second mutable total.
“Reserve before allocation” must honestly mean before package-owned copying or
registry retention; Node may already have allocated parser/socket objects before
its callback.

4. **HTTP pipelining is unbounded/undefined.** Node can parse multiple requests
on one keep-alive connection while an earlier response is pending. V1 must either
serialize with a bounded queue or reject pipelining. It cannot pretend one
exchange per socket. Specify ordering, queue bytes/count, admission, timeout,
and close behavior.

5. **M0c evidence is still host-shaped.** The pre-listen cancellation,
backpressure script, and upgrade transfer must pass through generated debug and
optimized effect-manager workers. Upgrade proof must transfer a deliberately
non-empty `head`, prove byte identity, and cover rejection/timeout as well as
successful claim. No production code until this evidence exists.

6. **Exhaustive models lack checked evidence.** “Depth 8/10” without golden state
counts and digests permits accidental test shrinkage. The property plan must name
canonical command alphabets, pruning rules, expected counts/digests, and a
conformance runner applying every trace to both pure model and production
boundary. Goldens update only by reviewed script.

7. **`ws` provenance is not immutable enough.** A tarball copied from ambient
`node_modules` needs deterministic archive rules, SHA-256, package metadata,
license, lock provenance, pure-JS optional dependency policy, archive
reproduction check, and tests that run only from the offline extraction.

## Required test expansion

Before implementation acceptance, tests must include raw-socket slowloris
(headers and body), fixed/chunked over-limit behavior, bounded discard, malformed
framing/trailers, client abort races, scripted `write(false)`/`drain`, finish vs
close precedence, pipelined request ordering/overflow, graceful-close deadline,
upgrade claim/reject/timeout with non-empty head, budget reservation leak checks,
and generated debug/optimized parity.

## Scope ruling

Broad HTTP v1 remains accepted in scope. Public WebSocket remains deferred. The
private pinned-`ws` bridge is integration machinery and must not leak raw sockets
or become a general foreign-adapter registry. Package audit must finish before
any harness integration branch is created.
