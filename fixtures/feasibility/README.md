# HTTP server effect-manager feasibility fixture

Evidence only; not production implementation.

```sh
node scripts/run.cjs
```

The runner uses the pinned Schelm compiler and public-package seed already
present in the sibling `schelm-node-http-client` worktree. It compiles and runs
real debug and optimized Elm workers against Node 24.4.1. Generated files live
under ignored `build/`.
