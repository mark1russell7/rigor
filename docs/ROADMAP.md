# Roadmap

This file lists the items of the roadmap of this repository. The status page of the site reads it.

## In progress

| ID | Status | Priority | Title |
| --- | --- | --- | --- |
| R8 | in progress | P0 | chaos: fault plans, the fault proxy, and schedules with their measures. Done: seeded fault plans (#200), the proxy for TCP, HTTP and WebSocket (#201), the answer fault (#208), the sweep points (#211) and the windows (#216). Open: schedules of latency and failure |
| R13 | in progress | P1 | bench: the five local harnesses (Vex, packing, highways, layout-contract, typeset) use rigor-bench. The survey found 8 gaps. Done: `timeArm`, the child-side timer of one arm (#218). Next: the fields of each child, then each repository removes its copy |

## Next

| ID | Status | Priority | Title |
| --- | --- | --- | --- |
| R3 | next | P2 | The moves: each repository with a copy of mulberry32 or of a statistics function imports the package, with records that stay equal. layout-contract is done |
| R6 | next | P2 | gates: the determinism gate (one input gives one hash), the promotion test and the performance evidence |
| R11 | next | P2 | statistics: the fold rule, next to `sobolIndices`. A model counts when it beats the mean on each held-out fold. highways and packing use it |
| R12 | next | P2 | bench: the k-of-n read of joint non-domination. An entry wins only when no control dominates it on k of n stated measures |
| R14 | next | P2 | bench: the verdicts that coeval asked for. These are a verdict for each case from its rounds, a slope verdict, the bias of a case between jobs and limits from A/A records |
| R16 | next | P2 | bench: several case modules in one run, and fixture files with a pinned hash (#115) |
| R17 | next | P2 | bench: gate rules for holds, early stops and two commits as paired arms in one job (#55) |
| R19 | next | P2 | Upkeep: pull requests #99 and #103, and the old worktrees of earlier sessions |

## Later

| ID | Status | Priority | Title |
| --- | --- | --- | --- |
| R2 | later | P2 | The site: live demos of a fault plan and the proxy, next to the generator and the time verdict |
| R7 | later | P2 | testgen: property tests on fast-check, pairwise and covering arrays, metamorphic relations |
| R9 | later | P2 | Shrinking of a failed input. It goes with the test generators (R7). statistics 0.1.22 has `sobolIndices` |
| R10 | later | P3 | statistics: an optional sum of the squared kernel for `uStatisticInterval`, for an empirical Bernstein bound. It waits for a consumer at `k > 500`. `docs/CALIBRATION.md` has the read |
| R18 | later | P3 | statistics: a moving-block bootstrap, so the interval of a mean of a correlated series is not too narrow |

## Done

| ID | Status | Priority | Title |
| --- | --- | --- | --- |
| R1 | done | P1 | generators 0.1.0: the seeded generator and its draws, equal to the byte to each copy of mulberry32. Done on 2026-10-29 |
| R4 | done | P1 | statistics 0.1.0: quantiles, intervals and tests, equal to the bit to each copy. Done on 2026-10-29 |
| R5 | done | P1 | generators: input families with dimensions and ranges, stratified and Latin hypercube designs, Saltelli designs (#168, #169, #170). Done on 2026-11-08 |
| R15 | done | P0 | chaos: faults in time windows, with the times to detect and to recover. A window fault applies to each connection that is open in the window. `windowResponse` gives the verdicts pass, fail or no read. Done on 2026-11-15 (#216) |
