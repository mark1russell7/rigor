# Roadmap

This file lists the items of the roadmap of this repository. The status page of the site reads it.

## In progress

| ID | Status | Priority | Title |
| --- | --- | --- | --- |
| R8 | in progress | P0 | chaos: fault plans, the fault proxy, and schedules with their measures. Done: seeded fault plans (#200), the proxy for TCP, HTTP and WebSocket (#201), the answer fault (#208), the sweep points (#211) and the windows (#216). Open: schedules of latency and failure |
| R13 | in progress | P1 | bench: the five local harnesses (Vex, packing, highways, layout-contract, typeset) use rigor-bench. The survey found 8 gaps. Done: `timeArm`, the child-side timer of one arm (#218), the fields of each child (#219, #220, #222), gate limits from runs and A/A records (#225), two commits as paired arms in one job (#226), and a decision for each case over k processes with a count of slow ones (#230). Next: an in-process mode for more than 2 arms, then each repository removes its copy |
| R7 | in progress | P2 | testgen: property tests on fast-check, pairwise and covering arrays, metamorphic relations. Done: `uniformDouble`, numbers uniform by value over a range (#227). Next: the property tests of this repository use it |

## Next

| ID | Status | Priority | Title |
| --- | --- | --- | --- |
| R3 | next | P2 | The moves: each repository with a copy of mulberry32 or of a statistics function imports the package, with records that stay equal. layout-contract is done |
| R6 | next | P2 | gates: the determinism gate (one input gives one hash), the promotion test and the performance evidence |
| R11 | next | P2 | statistics: the fold rule, next to `sobolIndices`. A model counts when it beats the mean on each held-out fold. highways and packing use it |
| R12 | next | P2 | bench: the k-of-n read of joint non-domination. An entry wins only when no control dominates it on k of n stated measures |
| R14 | next | P2 | bench: the verdicts that coeval asked for. These are a verdict for each case from its rounds, a slope verdict and the bias of a case between jobs. Done: the timed samples in a fresh child (#218) and limits from A/A records (#225) |
| R16 | next | P2 | bench: several case modules in one run, and fixture files with a pinned hash (#115) |
| R17 | next | P2 | bench: gate rules for holds and early stops. Done: two commits as paired arms in one job (#226) |
| R19 | next | P2 | Upkeep: pull requests #99 and #103, and the old worktrees of earlier sessions |

## Later

| ID | Status | Priority | Title |
| --- | --- | --- | --- |
| R2 | later | P2 | The site: live demos of a fault plan and the proxy, next to the generator and the time verdict |
| R9 | later | P2 | Shrinking of a failed input. It goes with the test generators (R7). statistics 0.1.22 has `sobolIndices` |
| R10 | later | P3 | statistics: an optional sum of the squared kernel for `uStatisticInterval`, for an empirical Bernstein bound. It waits for a consumer at `k > 500`. `docs/CALIBRATION.md` has the read |
| R18 | later | P3 | statistics: a moving-block bootstrap, so the interval of a mean of a correlated series is not too narrow |

## Done

| ID | Status | Priority | Title |
| --- | --- | --- | --- |
| R1 | done | P1 | generators 0.1.0: the seeded generator and its draws, equal to the byte to each copy of mulberry32. Done on 2026-10-29 |
| R4 | done | P1 | statistics 0.1.0: quantiles, intervals and tests, equal to the bit to each copy. Done on 2026-10-29 |
| R5 | done | P1 | generators: input families with dimensions and ranges, stratified and Latin hypercube designs, Saltelli designs (#168, #169, #170). Done on 2026-11-08 |
| R15 | done | P0 | chaos: faults in time windows, with the times to detect and to recover. A window fault applies to each connection that is open in the window. `windowResponse` gives the verdicts pass, fail or no read. Done on 2026-11-15 (#216). A fix: `close()` of the proxy gives the summary of each open connection before it resolves |
