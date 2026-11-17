# Roadmap

This file lists the items of the roadmap of this repository. The status page of the site reads it.

## In progress

| ID | Status | Priority | Title |
| --- | --- | --- | --- |
| R13 | in progress | P1 | bench: the five local harnesses (Vex, packing, highways, layout-contract, typeset) use rigor-bench. The survey found 8 gaps. Done: `timeArm`, the child-side timer of one arm (#218), the fields of each child (#219, #220, #222), gate limits from runs and A/A records (#225), two commits as paired arms in one job (#226), a decision for each case over k processes with a count of slow ones (#230), more than 2 arms in one process (`timeArmRounds`) and the limit of a gate of 1 case from its own A/A rounds (`aaFrom: "rounds"`, 0.2.47). A fresh child for each arm in each round with balanced rounds, a list of case modules, fixture files with a pinned SHA-256 and the A/A of each order (`freshArms`, 0.2.49) are in progress for typeset (#115). The text bench of `layout-contract` uses `timeArmRounds`, with a second load of the base build as its A/A arm (layout-contract#333). Next: Vex, packing, highways and typeset remove their copies |

## Next

| ID | Status | Priority | Title |
| --- | --- | --- | --- |
| R14 | in progress | P2 | bench: the verdicts that coeval asked for. These are a verdict for each case from its rounds, a slope verdict and the bias of a case between jobs. Done: the timed samples in a fresh child (#218), limits from A/A records (#225) and the slope verdict of a log-log ladder with the A/A check of each run (`slopeVerdict`, 0.2.48) |
| R16 | next | P2 | bench: several case modules in one run, and fixture files with a pinned hash (#115) |

## Later

| ID | Status | Priority | Title |
| --- | --- | --- | --- |
| R3 | later, after R13 | P2 | The moves: each repository with a copy of mulberry32 or of a statistics function imports the package, with records that stay equal. layout-contract is done |
| R6 | later, after R13 | P2 | gates: the determinism gate (one input gives one hash), the promotion test and the performance evidence |
| R17 | later, after R13 | P2 | bench: gate rules for holds and early stops. Done: two commits as paired arms in one job (#226) |
| R10 | later | P3 | statistics: an optional sum of the squared kernel for `uStatisticInterval`, for an empirical Bernstein bound. It waits for a consumer at `k > 500`. `docs/CALIBRATION.md` has the read |

## Done

| ID | Status | Priority | Title |
| --- | --- | --- | --- |
| R1 | done | P1 | generators 0.1.0: the seeded generator and its draws, equal to the byte to each copy of mulberry32. Done on 2026-10-29 |
| R2 | done | P2 | The site: live demos of a fault plan and the proxy, next to the generator and the time verdict. The entry `rigor-proxy/applier` has no module of Node.js, so the page can load the applier (proxy 0.3.2, #253). The demo of a fault plan shows the frames, the writes and the faults of each connection (#254). The site check of CI covers 360 px, 390 px and 1280 px, in light and dark, with the probe of the time verdict. The table of packages gives the current parts of testkit and chaos. Done on 2026-11-16 |
| R4 | done | P1 | statistics 0.1.0: quantiles, intervals and tests, equal to the bit to each copy. Done on 2026-10-29 |
| R5 | done | P1 | generators: input families with dimensions and ranges, stratified and Latin hypercube designs, Saltelli designs (#168, #169, #170). Done on 2026-11-08 |
| R8 | done | P0 | chaos: fault plans, the fault proxy, and schedules with their measures. Done: seeded fault plans (#200), the proxy for TCP, HTTP and WebSocket (#201), the answer fault (#208), the sweep points (#211) and the windows (#216). Done on 2026-11-15: the schedules of latency and failure (`latencyWindows` and `failureWindows`, 0.3.1) |
| R9 | done | P2 | Sobol indices and shrinking. statistics 0.1.22 has `sobolIndices`. Done on 2026-11-15: `shrinkPoint` and `shrinkPointAsync` shrink a failed point of an input family toward the target of each dimension (generators 0.1.18) |
| R11 | done | P2 | statistics: the fold rule, next to `sobolIndices`. A model counts when it beats the mean on each held-out fold. Done on 2026-11-15: `foldSkills` and `foldRule` (statistics 0.2.6). Next: highways and packing remove their copies |
| R15 | done | P0 | chaos: faults in time windows, with the times to detect and to recover. A window fault applies to each connection that is open in the window. `windowResponse` gives the verdicts pass, fail or no read. Done on 2026-11-15 (#216). A fix: `close()` of the proxy gives the summary of each open connection before it resolves |
| R18 | done | P3 | statistics: a moving-block bootstrap, so the interval of a mean of a correlated series is not too narrow. Done on 2026-11-15: `bootstrapMovingBlock`, `bootstrapMovingBlockLeastSquares` with a circular form, and `blockLength` of Politis and White (statistics 0.2.8) |
| R19 | done | P2 | Upkeep: pull requests #99 and #103, and the old worktrees of earlier sessions. Done on 2026-11-15: #103 (bench 0.2.50) and #99 (bench 0.2.51) merged, and 29 old worktrees are removed |
| R20 | done | P2 | chaos: stop plans for a process of a test. A seeded plan gives the steps or the times of each stop, with `SIGKILL` or `SIGTERM` (`stopPlan`, chaos 0.3.2). The entry `/stop` of testkit stops a child at each stop and records its last point (testkit 0.1.12). The first user is a crash suite of a SQLite file. Done on 2026-11-16 (#248) |
| R7 | done | P2 | testgen: property tests on fast-check, pairwise and covering arrays, metamorphic relations. Done: `uniformDouble`, numbers uniform by value over a range (#227), and the property tests of this repository use it (#229). The gap list #145: `startOtlpCollector` (entry `/otlp`) and `createFakeEventTarget` (entry `/fakes`), testkit 0.1.9. Covering arrays in generators 0.1.17: `coveringArray`, `coveringRows` and `tupleCoverage`, of any strength. The array has the rows of the copy in `layout-contract`. Metamorphic relations in testkit 0.1.13: the entry `/metamorphic`, with `checkRelations`, `equivariant`, `invariant`, `permutationInvariant` and `composeRelations`. A behavior check in testkit 0.1.15: the entry `/behavior`, with `behaviorCheck` in one process and `behaviorDigest` with `compareDigests` across two processes (#144). Done on 2026-11-16 |
| R21 | done | P2 | chaos: disk plans for a process of a test, one family of disk faults with one shape. The first kind is `lose-unsynced`, a power cut that loses each write after the last fsync (`diskPlan`, chaos 0.3.3). The kind keeps each directory entry. The testkit entry `/stop` gives `stopOrderOf` and `parseProgress` to a harness (testkit 0.1.14). The first harness is the disk tier of `@mark1russell7/harness` (mark1russell7/systems#560). Done on 2026-11-16 (#255). Later kinds: the loss of directory entries, a torn write and an fsync error |
| R22 | done | P2 | testkit: for a stop at a time, `stopped` is `false` for an exit code of 0. A child that ended a moment before the signal gave `true` (`stopOccurred`, testkit 0.1.16). Done on 2026-11-16 |
| R23 | done | P1 | generators: the option `tags: "typed"` of `canonicalJson` writes a `Date`, a `RegExp`, a `Map`, a `Set` and a `bigint` with a tag. Then the 3 copies of a stable JSON text in `client` can move here, with the same keys (generators 0.1.19). The default changes no hash. Then the default refuses each object that keeps its content out of its own keys, for example a `Map`, a `RegExp` or an `Error`, with a `TypeError` (generators 0.2.0, a breaking change). Done on 2026-11-16 |
| R24 | done | P1 | testkit: the entry `/stop-point` has the child side of the stop protocol, with only `node:` imports. A harness copies this one file into a container with no packages. The build stops when the file imports another module (testkit 0.1.18). Done on 2026-11-16 |
| R25 | done | P1 | tests: each package gives each test a limit of 20 s, in place of the 5 s of vitest. Over 10 CI runs, a test with no limit of its own took up to 4.4 s, and a slow runner doubled a time. Done on 2026-11-16 |
| R26 | done | P2 | statistics: `pearson(a, b)`, and `correlationPermutation(a, b, options)`, the permutation test of a correlation with a seed. The statistic is Pearson, Spearman or a function. When `n!` is `runs` or less, the p is exact (statistics 0.2.10). Done on 2026-11-16 |
| R27 | done | P1 | testkit: WebSocket routes on the scripted server of the entry `/http`, with the frame codec of RFC 6455 in rigor-proxy (`readWebSocketFrame`, `encodeWebSocketFrame`). A session is the reply to the handshake and the steps of the server, as data. The tests of WebSocket clients use them (proxy 0.4.1, testkit 0.1.19). Done on 2026-11-16 |
| R28 | done | P1 | testkit: a scripted XMPP server in the entry `/xmpp` (RFC 6120). The negotiation (STARTTLS, SASL PLAIN, the bind) and the steps of each connection are data. The server records each stanza and the place of each write on the wire. The entry `/tls` makes the certificates of a test at the time of the test, so no key goes into git. The tests of XMPP clients use them (testkit 0.1.20). Done on 2026-11-16 |
| R29 | done | P2 | statistics: `totalCalibration`, the count of hits of independent predictions against the sum of their chances (`expected`, `sd`, `z`, `within2`). Its p values come from the exact Poisson binomial law: `poissonBinomial` and `poissonBinomialTest` (statistics 0.2.11). Done on 2026-11-17 |
| R12 | done | P2 | bench: the k-of-n read of joint non-domination. highways#441 answered that `jointClaim` with its verdict `survives` covers JOINT-WIN, so R12 closes with no change. A repository that needs a k-of-n read states its meaning and its k in a new issue. Done on 2026-11-17 |
