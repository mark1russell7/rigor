# @mark1russell7/rigor-chaos

This package holds open-loop load schedules and the measure of latency that goes with them. It also holds seeded fault plans for a proxy, and seeded stop plans and disk plans for a process of a test.

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
| `delay` | Each frame that it reads in the next `forMs` goes out `ms` later. It does not stop its reads. |
| `stall` | It stops reading the direction for `ms`. The sender sees back pressure. |
| `cut` | It ends both directions with a FIN. |
| `reset` | It destroys both directions with a TCP reset. |
| `split` | The frame goes out in `pieces` writes, with `gapMs` between two writes. |
| `reorder` | The next `count` frames go out in the reverse order. After `holdMs`, it sends the frames that it holds. |
| `duplicate` | The frame goes out `1 + copies` times. |
| `answer` | It writes an HTTP/1.1 response with `status`, `fields` and `body` to the client, and ends both directions with a FIN. |

Each fault names its connection (the number of the connection, from 0), its direction (`up` to the server, `down` to the client) and its point. A point is a time in ms from the start of the connection, a count of bytes, or a count of frames.

```ts
import { faultPlan } from "@mark1russell7/rigor-chaos";

const plan = faultPlan({ connections: 20, perConnection: 3, kinds: { split: 2, delay: 1, reset: 1 }, within: { frame: 50 } }, "drill");
```

- Each connection draws from its own stream of the seed. Thus a spec with more connections keeps the faults of the first connections.
- Each draw is an integer, thus the same seed gives the same plan on each platform.
- `ranges` sets the interval of each parameter. `DEFAULT_FAULT_RANGES` gives the intervals that a spec does not set.
- `faultPlanOf` makes a plan from faults that a person wrote. `checkFaultPlan` gives each problem of a plan from a record.
- A spec does not draw an `answer`, because a person chooses its status and its fields. Write each answer in a plan with `faultPlanOf`.

```ts
import { faultPlanOf } from "@mark1russell7/rigor-chaos";

// The client gets a 429 in place of the response of the server.
const plan = faultPlanOf([{ connection: 0, direction: "down", at: { frame: 0 }, kind: "answer", status: 429, fields: { "retry-after": "120" } }]);
```

### A sweep of one fault

A sweep puts one fault at a different point in each run. `sweepPoints` gives the points: the edges 0, 1 and `length - 1`, and distinct seeded points between them.

```ts
import { faultPlanOf, sweepPoints } from "@mark1russell7/rigor-chaos";

// One cut in each run: in the body of an HTTP response with a head of 180 bytes and a body of 6000 bytes.
for (const offset of sweepPoints(6000, 16, "cut-in-body")) {
  const plan = faultPlanOf([{ connection: 0, direction: "down", at: { byte: 180 + offset }, kind: "cut" }]);
}
```

- The edges find the faults at the start and at the end of a stream. The seeded points find the faults between them.
- The same seed gives the same points on each platform.

### A window of faults

A fault of a window applies to each connection that is open at a time in the window. Thus a window makes an outage or a slow period of a server. The time of a window counts in ms from the start of the plan.

```ts
import { faultPlanOf } from "@mark1russell7/rigor-chaos";

// From 1 s to 4 s, the proxy resets each request at its first byte.
const plan = faultPlanOf([], [{ window: { from: 1000, to: 4000 }, direction: "up", at: { byte: 0 }, kind: "reset" }]);
```

- The point of a window fault counts from the start of the window, or from the start of a connection that opens in the window.
- A fault that is not due before the end of the window does not occur.
- A plan with windows has the format `rigor-faults/2`. A reader of `rigor-faults/1` refuses it, thus it does not drop the windows with no word.
- `checkWindowFault` gives each problem of one fault of a window.

### A schedule of faults

A schedule of faults changes the size or the rate of a fault over the run. It reads a profile, as a load schedule does, and gives window faults for `faultPlanOf`.

```ts
import { failureWindows, faultPlanOf, latencyWindows, ramp, spike } from "@mark1russell7/rigor-chaos";

// The replies get slow: the delay goes from 0 to 2000 ms over 60 s, in steps of 1 s.
const slow = latencyWindows(ramp(0, 2000, 60_000), { stepMs: 1000 });
// A burst of outages: 5 failures each second for 10 s, each a reset of 200 ms, at seeded Poisson times.
const outages = failureWindows(spike(0, 5, { before: 20_000, width: 10_000, after: 30_000 }), { action: { kind: "reset" }, widthMs: 200, seed: "drill" });
const plan = faultPlanOf([], [...slow, ...outages]);
```

- In `latencyWindows`, the value of the profile is a delay in ms. Each step gets one `delay` window with the mean delay of the step. A step with no delay gets no window.
- The proxy keeps the larger of two delays that overlap. A connection that opens in a step thus keeps the delay of the step for up to one step.
- In `failureWindows`, the value of the profile is a rate of failures each second. The failures start at the times of `schedule` with Poisson arrivals.
- Two failures that overlap make one window. The default point `{ ms: 0 }` stops each connection of a failure at once.
- The fault of a failure can be any fault. A `reset` or a `cut` makes an outage. A `stall` makes a hang, and an `answer` makes an error reply.

### The response to a window

`windowResponse` reads a series of samples of a health signal. It gives the time to detect the window and the time to recover after it.

```ts
import { windowResponse } from "@mark1russell7/rigor-chaos";

const response = windowResponse({ from: 1000, to: 4000 }, samples, { detectMs: 2000, recoverMs: 3000 });
// response.detected and response.recovered are "pass", "fail" or "no read".
```

- The time to detect is from the start of the window to the first sample down.
- The time to recover is from the end of the window to the first sample up after it. A detection after the end moves this start to the detection.
- A gate that cannot read the case gives `no read`, not a pass. This occurs when the signal is not steady and up before the window, or when the samples end before the limit.
- With no detection, the recovery has no read.

## A stop plan

A stop plan tells a harness where to stop a process of a test, with `SIGKILL` or `SIGTERM`. The test then examines the state that the process left, for example a database file after a stop in a transaction. The harness is the entry `/stop` of `@mark1russell7/rigor-testkit`.

```ts
import { stopPlan, stopPlanOf } from "@mark1russell7/rigor-chaos";

// The program passes 240 stop points in a complete run. Each stop of the plan is one run.
const plan = stopPlan({ within: { step: 240 }, draws: 16, signals: ["SIGKILL", "SIGTERM"] }, "crash-in-commit");

// A stop that a person wrote: 1.5 s after the start.
const late = stopPlanOf([{ at: { ms: 1500 }, signal: "SIGKILL" }]);
```

- A step counts the calls of the stop point in the program from 0. A time counts the ms from the start of the process.
- The points of a plan are those of `sweepPoints`. A limit with fewer points than `draws + 3` gives each point.
- Each point has one stop for each signal. The stops are in the order of their points, then of their signals.
- `checkStopPlan` gives each problem of a plan from a record. `stopPlanOf` makes a plan from stops that a person wrote.

## A disk plan

A disk plan tells a harness which disk fault to apply to the files of a test process, and at which point. The test then examines the files that the disk kept. For example, it measures the data loss of each synchronous setting of a database. A harness applies a plan. The first harness is the disk tier of `@mark1russell7/harness`, in review in [mark1russell7/systems#560](https://github.com/mark1russell7/systems/pull/560).

| Kind | What the disk does |
|---|---|
| `lose-unsynced` | A power cut: the process stops at once, and the disk loses each write of data after the last fsync of its file. The kind keeps each directory entry: a new file, a rename or an unlink is durable at once. A later kind loses the entries after the last fsync of their directory. |

```ts
import { diskPlan, diskPlanOf } from "@mark1russell7/rigor-chaos";

// The program passes 240 stop points in a complete run. Each fault of the plan is one run.
const plan = diskPlan({ within: { step: 240 }, draws: 16 }, "power-cut-in-commit");

// A fault that a person wrote: 1.5 s after the start.
const late = diskPlanOf([{ kind: "lose-unsynced", at: { ms: 1500 } }]);
```

- The faults are one family with one shape: a kind and a point. A torn write and an fsync error are the next kinds.
- A point has the form of the point of a stop. The same spec and seed give the points of `stopPlan`.
- Each point has one fault for each kind of the spec. The faults are in the order of their points, then of their kinds.
- `checkDiskPlan` gives each problem of a plan from a record. `diskPlanOf` makes a plan from faults that a person wrote.

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
