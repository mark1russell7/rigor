# @mark1russell7/rigor-chaos

This package holds open-loop load schedules, and the measure of latency that goes with them.

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
