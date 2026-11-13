# @mark1russell7/rigor-chaos

This package holds open-loop load schedules, the measure of latency that goes with them, and seeded fault plans for a proxy.

A closed-loop driver waits for each reply before its next request. A stall of the target thus stops the load, and the measure shows one slow request. This is coordinated omission. An open-loop schedule fixes each arrival time before the run, and a measure counts each latency from its planned time.

## A schedule

A profile is a rate over time, in straight pieces. `constant`, `ramp`, `steps` and `spike` make the common ones. `schedule` gives the planned times, in ms from the start.

```ts
import { schedule, spike } from "@mark1russell7/rigor-chaos";

const plan = schedule(spike(100, 1000, { before: 10_000, width: 1000, after: 10_000 }), { arrivals: "poisson", seed: "drill" });
```

- `uniform` arrivals have equal gaps at a fixed rate, and no random part.
- `poisson` arrivals have independent gaps. The seed gives the same times again on one platform.

A schedule is data. A driver reads `times`, and it sends each arrival at its time with no wait for a reply. The driver is not in this package, because it belongs to the process that makes the load. A record keeps the schedule, because `poisson` times use `Math.log`.

## A measure

`measureLoad` takes the schedule, what the driver saw of each arrival, and the end of the run.

- `latency` is the reply less the planned time. This is what a user waited.
- `service` is the reply less the send. This is what a closed-loop driver measures.
- `lag` is the send less the planned time.
- `censored` holds the age at the end of each arrival with no reply. Each value is a lower bound of a latency.
- `seconds` is optional. It holds the samples that the driver read of itself: the processor share, and the p99 and the largest delay of its event loop.

`latencyQuantile` reads the latency and the censored values together, by the nearest rank. Thus an arrival with no reply does not leave the measure.

`scheduleHeld` tells if the driver kept the schedule. A run that fails this check measures its driver, not its target. An A/A run with no fault examines this first. When a run fails this check, `seconds` tells if a full processor or a held event loop made the sends late.

## A fault plan

A fault plan tells a proxy which faults to put into which connections, and at which points. A seed fixes the plan before the run. The proxy that applies a plan is `@mark1russell7/rigor-proxy`.

| Kind | What the proxy does |
|---|---|
| `delay` | Each frame that it reads in the next `forMs` goes out `ms` later. It keeps reading. |
| `stall` | It stops reading the direction for `ms`. The sender sees back pressure. |
| `cut` | It ends both directions with a FIN. |
| `reset` | It destroys both directions with a TCP reset. |
| `split` | The frame goes out in `pieces` writes, with `gapMs` between two writes. |
| `reorder` | The next `count` frames go out in the reverse order. After `holdMs`, it sends the frames that it holds. |
| `duplicate` | The frame goes out `1 + copies` times. |

Each fault names its connection (the number of the connection, from 0), its direction (`up` to the server, `down` to the client) and its point. A point is a time in ms from the start of the connection, a count of bytes, or a count of frames.

```ts
import { faultPlan } from "@mark1russell7/rigor-chaos";

const plan = faultPlan({ connections: 20, perConnection: 3, kinds: { split: 2, delay: 1, reset: 1 }, within: { frame: 50 } }, "drill");
```

- Each connection draws from its own stream of the seed. Thus a spec with more connections keeps the faults of the first connections.
- Each draw is an integer, thus the same seed gives the same plan on each platform.
- `ranges` sets the interval of each parameter. `DEFAULT_FAULT_RANGES` gives the intervals that a spec does not set.
- `faultPlanOf` makes a plan from faults that a person wrote. `checkFaultPlan` gives each problem of a plan from a record.

## A closed-loop record

`closedLoopPlan` reads a run of a closed-loop driver that sends each `interval` ms. It puts back the sends that each stall hid, by the rule of `recordValueWithExpectedInterval` of HdrHistogram.

```ts
import { closedLoopPlan, latencyQuantile, measureLoad } from "@mark1russell7/rigor-chaos";

const { plan, completions, driverGaps } = closedLoopPlan(requests, { interval: 10, end, tolerance: 2 });
const p99 = latencyQuantile(measureLoad(plan, completions, end), 0.99);
```

- A request with a reply later than one interval hides the planned sends at `sent + j × interval` before that reply.
- Each hidden send gets the reply that ended the stall. Its lag is its wait, and its service is 0.
- A pause of the driver itself also hides sends. The driver expects its next send at the later of `sent + interval` and the reply.
- A send later than that time by more than `tolerance` is a driver gap. Each planned send in the gap is hidden, and it gets the real send and its reply.
- `driverGaps` and `driverGapTotal` count these gaps and their delay in ms. A pause of the driver thus does not make the estimate better than the open loop.
- A driver that waits after each reply gives that wait as `pause`, and `interval` the same value. Its send at `done + pause` is then not a driver gap.
- The plan starts again at each real send. The driver does not send faster after a stall, thus a later send is not late.
- After a request with no reply, each hidden send is not sent, and its age at the end is a lower bound.

The result is an estimate of the open loop, not a measure of it. A record of an open-loop driver stays the better measure.
