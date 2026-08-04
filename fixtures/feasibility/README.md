# HTTP server effect-manager feasibility fixture

Evidence only; not production implementation.

```sh
node scripts/run.cjs
```

The runner uses the pinned Schelm compiler and public-package seed already
present in the sibling `schelm-node-http-client` worktree. It compiles and runs
real debug and optimized Elm workers against Node 24.4.1. Generated files live
under ignored `build/`.

Additional production-boundary probes:

```sh
node scripts/runtime-probes.cjs
```

They execute an actual pre-listen cancellation, instrument real
`write(false)`/`drain` behavior against a paused client, and exercise the
proposed private exactly-once upgrade bridge with the harness-pinned `ws`
8.21.1 package. The absolute harness path is fixture-only provenance and must
not enter production package code.
