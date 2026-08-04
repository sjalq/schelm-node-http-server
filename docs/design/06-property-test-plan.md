# 06 — Property and evidence plan

## 1. Canonical model suites

Each suite has a checked alphabet, canonical state encoding, symmetry pruning,
expected terminal/state/trace counts, and SHA-256 digest in
`tests/golden/model-counts.json`. The initial implementation computes and checks
these values; this design does not fabricate counts before the model exists.
Tests fail if a golden is absent. `scripts/update-model-goldens.cjs` is the only
writer, requires a clean tree and `--reviewed`, and prints old/new counts and
digests for review.

Suites:

| Model | Alphabet | Depth |
|---|---|---:|
| listener | listen, cancel, listening, error, close, deadline, stale fact | 8 |
| reply | admit, self success/fail, duplicate, map, cancel | 8 |
| route | zero, one A, one B, duplicate, incoming, deliver | 9 |
| budget | reserve classes/amounts, release valid/stale, terminal | 9 |
| body | fixed/chunked, read, chunk, EOF, trailer, discard, limit, abort, deadline | 10 |
| writer | write true/false, drain, end, finish, close, error, deadline | 10 |
| pipeline | first, second, body EOF, response finish, overflow close | 8 |
| upgrade | offer, claim, reject, timeout, close, duplicate | 9 |
| graceful close | HTTP/upgrade active/terminal, close, deadline | 9 |

Canonical encoding sorts ids, alpha-renames freshly minted ids by first use, and
omits diagnostic timestamps. Pruning removes only operations proven commutative
on disjoint canonical ids and records the pruning-rule version in the digest.
Every reachable transition checks invariants before expansion.

## 2. Model/boundary conformance

For every canonical trace, the conformance runner feeds the same primitive facts
to:

1. pure Elm transition model;
2. debug generated production manager fixture;
3. optimized generated production manager fixture;
4. injected kernel simulator.

Normalized outputs (replies, events, physical verbs, reservations, final state)
must match. Debug/opt fixture JSON has checked golden digest. `SelfMsg` payloads
contain only ids/facts; an artifact grep rejects application-tagger references
in kernel JS. A `Cmd.map` fixture proves replies and subscriptions map exactly
once. Duplicate subscriptions prove `Ambiguous`, no first/last winner, bounded
503 fallback, and stable generation across ordinary single-route reconcile.

## 3. M0c tests

- generated debug/opt pre-listen cancellation with withheld `listening`, no
  success reply, one cancel result, empty registry, immediate port reuse;
- scripted writer false positions (first, middle, consecutive attempted misuse),
  no physical write while blocked, one retained chunk, exact ordered bytes;
- real paused client: positive `write(false)`, equal drain count, bounded maximum
  writable length, exact 4 MiB receipt;
- raw upgrade with non-empty `head`: exact bytes/object identity to offline `ws`,
  successful echo, duplicate claim rejected;
- upgrade rejection returns fixed bounded status and closes;
- upgrade timeout destroys and releases reservation;
- fixture counters positive in fixtures and absent from production artifacts.

## 4. Raw HTTP/runtime tests

### Slowloris

Using raw `net.Socket` and short configured caps:

- drip incomplete header below/above `headersTimeout`;
- complete headers then drip body across `requestTimeout` and body-progress cap;
- idle keep-alive across `keepAliveTimeout` buffer;
- too many headers and too many sequential requests/socket.

Assert bounded closure, registry/reservation zero, no application event after
terminal, and effective Node knobs equal configuration.

### Framing/body/trailers

- fixed body at limit, declared over limit, premature EOF;
- chunked at/crossing limit; over-limit bytes never delivered;
- duplicate Content-Length, TE+CL, unsupported coding, malformed chunks;
- valid duplicate trailers after EOF and malformed/oversized trailers;
- explicit discard EOF/reuse, discard byte overflow, discard deadline;
- application early response with auto-discard on/off;
- client `aborted/error/close` at every body phase.

### Responses/backpressure

- HEAD, 1xx rejection, 204/304 body rejection, Content-Length consistency;
- write true/false/drain scripts and real slow reader;
- close before finish => `PeerClosed`; finish before close =>
  `AcceptedByNode`; injected late permutations remain single-terminal;
- finish/write deadlines destroy and release bytes.

### Pipelining

Send two complete requests in one TCP write and variants with partial second
body. Assert exactly one application offer, no second retained exchange/body,
first response not reordered, deterministic close, zero reservations. Sequential
keep-alive remains supported up to `maxRequestsPerSocket`.

### Close

Active/idle HTTP sockets, pending body, blocked writer, offered/accepted upgrade,
multiple bounded close joiners, excess waiter rejection, graceful completion,
and forced deadline. `CloseReport` partitions all resources once and final
budget/registry is empty.

## 5. Budget properties

For every transition:

- reservation precedes package map insertion/copy observation;
- all retained resources reference live reservation ids;
- no id released twice changes totals;
- listener/global/hard class totals never exceed limits;
- normal class cannot consume rejection reserve;
- terminal empty registry implies zero reservations;
- absent/ambiguous routing cannot grow pending self facts;
- event paths use indexed O(1) reserve/release, never derive totals by scanning.

Failure injection runs at reserve, post-reserve/pre-retain, post-retain/pre-self,
self delivery, and cleanup; rollback releases exactly the reservations acquired.

## 6. Provenance/artifact/reproducibility

- pinned compiler/Node/public seed hashes verified before build;
- offline `ws-8.21.1.tgz` hash and metadata verified, extracted without network;
- deterministic archive rebuilt from checked source payload and compared;
- optional native ws dependencies unavailable in test environment;
- cold and warm isolated overlay builds;
- package archive built twice with equal SHA-256;
- production JS rejects fixture names, observation hooks, absolute `/home` or
  `/opt/elm-harness` paths, ambient ws lookup, source maps, and undeclared files;
- positive controls prove every artifact check detects contamination;
- evidence manifest records commit, clean state, toolchain/dependency/artifact
  hashes, model golden counts/digests, runtime matrix, and commands.

## 7. Performance/boundedness

Measured gates use configured capacities and compare early/late windows:

- 200 listeners: event lookup does not scan listeners;
- 1,000 sequential requests: stable per-request allocations after warm-up;
- 10,000 body/write chunks: O(new chunk), no accumulated buffer traffic;
- absent/ambiguous subscriptions under connection attempts: stable memory;
- many blocked clients up to admission cap: retained bytes match reservations;
- forced close may be O(current live resources) once; hot tick/event paths may
  not be O(all resources/history).

Diff grep gate rejects accumulator `++ [ x ]` and `List.member` against growing
accumulators. Heap/RSS thresholds include Node transport buffers separately from
package-owned reservation bytes; claims distinguish them.

## 8. Release audit checklist

- all findings in reviews A/B mapped to executable tests;
- compiler warnings/format/diff checks clean;
- debug/opt conformance and real runtime suites green;
- model goldens present, counts nonzero, digests stable;
- Node 24.4.1 authority green; 24.x/22 observations recorded honestly;
- no public raw socket or WebSocket message API;
- API docs state cooperative authority and finish semantics;
- package repository clean, commit and immutable archive pushed;
- only after this audit may harness integration begin on a separate branch.
