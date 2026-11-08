/**
 * The cost of a bench run before it starts. The cost is a sum over the cells that the run measures. Each term is a count of
 * cells of a job at one size, times the calls of a cell, times the time of a call.
 *
 * - Give only the cells that the run measures. A cell that the job does not support at its size costs 0, so it is not a cell.
 * - The time of one call comes from probes of the same inputs, for each CPU model. Times of other inputs can be far off.
 * - More probes of one size give their mean. The median of a skewed set of inputs is too low for a sum.
 * - A size between two probe sizes gets a time on the straight line through them, on log scales of size and time.
 * - The size 0, for example an empty input, is not on the line. It gets the time of a probe at 0, else of the smallest probe size.
 * - A size outside the probe sizes gets a time on the line through the two nearest probe sizes. The job cost names these sizes.
 * - A cell over its budget at a size stops the job. The cells after the stop cost 0.
 * - The bench step of a job costs more than its calls: the start, the checks and the writes. `overhead` and `jobMinutes` add it.
 */

/** The cells of one job at one size that the run measures. */
export interface CostCells {
  readonly job: string;
  /** The size of the inputs, for example the count of items. It is finite and 0 or more. */
  readonly size: number;
  /** The count of the cells at this size that the run measures. It is a whole number of 0 or more. */
  readonly cells: number;
}

/** One probe: the time of one call of a job at one size, on one CPU model. */
export interface CostProbe {
  readonly job: string;
  /** The size of the inputs of the probe. It is finite and 0 or more. */
  readonly size: number;
  /** The CPU model of the runner of the probe. */
  readonly model: string;
  /** The time of one call in ms. It is finite and more than 0. More probes of one job, size and model give their mean. */
  readonly ms: number;
}

/** The budget of one cell for the sizes up to `upTo`. */
export interface CellBudget {
  /** The largest size of this budget. */
  readonly upTo: number;
  /** The largest time of all the calls of one cell, in ms. */
  readonly ms: number;
}

/** The options of a run cost. */
export interface RunCostOptions {
  /** The count of the calls of one cell: the warmup calls and the timed calls. It is a whole number of 1 or more. */
  readonly calls: number;
  /** A cell with a call slower than `ms` gets the count `calls` in place of `options.calls`. */
  readonly slow?: { readonly ms: number; readonly calls: number };
  /** The budgets of one cell. A size gets the budget with the smallest `upTo` that is not less than the size. */
  readonly budgets?: readonly CellBudget[];
  /** The count of the cells over budget at one size that stops a job. The default is 2. */
  readonly overruns?: number;
  /** The minutes of the bench step for each minute of calls, from an earlier run. The default is 1. */
  readonly overhead?: number;
  /** The minutes of each job that do not change with its cells. The default is 0. */
  readonly jobMinutes?: number;
}

/** The cost of one job on one CPU model. */
export interface JobCost {
  readonly job: string;
  /** The minutes of the bench step: `callMinutes` times `overhead`, plus `jobMinutes`. */
  readonly minutes: number;
  /** The minutes of the calls of the cells before the stop, and of the cells over budget at the stop. */
  readonly callMinutes: number;
  /** The count of the cells that the job measures before its stop. */
  readonly cells: number;
  /** The size where the job stops, or `undefined` when no cell is over its budget. */
  readonly stopsAt: number | undefined;
  /** The sizes with a time outside the probe sizes of the job, in increasing order. */
  readonly extrapolated: readonly number[];
}

/** The cost of the run on one CPU model, with each job on that model. */
export interface ModelCost {
  readonly model: string;
  /** The sum of the minutes of the jobs with a cost. */
  readonly minutes: number;
  readonly jobs: readonly JobCost[];
  /** The jobs with no probe on this model, in the order of their names. Their cost is not in `minutes`. */
  readonly missing: readonly string[];
}

/** The cost of a run on each CPU model of the probes. */
export interface RunCost {
  /** The cost on each model, in the order of the model names. */
  readonly models: readonly ModelCost[];
  /** The least cost over the models with no missing job, or `undefined` when each model has a missing job. */
  readonly low: number | undefined;
  /** The largest cost over the models with no missing job, or `undefined` when each model has a missing job. */
  readonly high: number | undefined;
}

/** This function gives the mean of a list that is not empty. A sum over cells follows the mean, and not the median. */
function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** This function gives the time at `size` on the line through two probes, on log scales of size and time. */
function onLine(size: number, a: readonly [number, number], b: readonly [number, number]): number {
  const exponent = Math.log(b[1] / a[1]) / Math.log(b[0] / a[0]);
  return a[1] * Math.pow(size / a[0], exponent);
}

/**
 * This function gives the time of one call at `size` from the probes of one job on one model. The `points` are the probes
 * at sizes more than 0, sorted by size, and `zero` is the time of the probes at 0. One probe size gives its time at each
 * size. The second value is true when the size is outside the probe sizes.
 */
function timeAt(points: readonly (readonly [number, number])[], zero: number | undefined, size: number): [number, boolean] {
  if (size === 0 && zero !== undefined) return [zero, false];
  if (points.length === 0) return [zero as number, true];
  if (size === 0) return [(points[0] as readonly [number, number])[1], true];
  const first = points[0] as readonly [number, number];
  const last = points[points.length - 1] as readonly [number, number];
  if (points.length === 1) return [first[1], size !== first[0]];
  if (size < first[0]) return [onLine(size, first, points[1] as readonly [number, number]), true];
  if (size > last[0]) return [onLine(size, points[points.length - 2] as readonly [number, number], last), true];
  for (let i = 0; i < points.length; i++) {
    const point = points[i] as readonly [number, number];
    if (point[0] === size) return [point[1], false];
    if (point[0] > size) return [onLine(size, points[i - 1] as readonly [number, number], point), false];
  }
  return [last[1], false];
}

/** This function gives the budget of one cell at `size`, or `undefined` when no budget covers the size. */
function budgetAt(budgets: readonly CellBudget[], size: number): number | undefined {
  let best: CellBudget | undefined;
  for (const budget of budgets) if (budget.upTo >= size && (best === undefined || budget.upTo < best.upTo)) best = budget;
  return best?.ms;
}

/** This function makes sure that a number is finite and more than 0, or 0 or more with `zero`. */
function check(value: number, name: string, zero = false): void {
  if (!(Number.isFinite(value) && (zero ? value >= 0 : value > 0))) throw new RangeError(`runCost: ${name} is ${value}, which is not finite and ${zero ? "0 or more" : "more than 0"}.`);
}

/**
 * This function gives the cost of a bench run on each CPU model of the probes. It refuses a value out of its range and
 * two entries of `cells` for one job and size with a `RangeError`. A job with no probe on a model is missing on that model.
 */
export function runCost(cells: readonly CostCells[], probes: readonly CostProbe[], options: RunCostOptions): RunCost {
  const overruns = options.overruns ?? 2;
  const overhead = options.overhead ?? 1;
  const jobMinutes = options.jobMinutes ?? 0;
  const budgets = options.budgets ?? [];
  if (!(Number.isInteger(options.calls) && options.calls >= 1)) throw new RangeError(`runCost: calls is ${options.calls}, which is not a whole number of 1 or more.`);
  if (options.slow !== undefined) {
    check(options.slow.ms, "slow.ms");
    if (!(Number.isInteger(options.slow.calls) && options.slow.calls >= 1)) throw new RangeError(`runCost: slow.calls is ${options.slow.calls}, which is not a whole number of 1 or more.`);
  }
  if (!(Number.isInteger(overruns) && overruns >= 1)) throw new RangeError(`runCost: overruns is ${overruns}, which is not a whole number of 1 or more.`);
  check(overhead, "overhead");
  check(jobMinutes, "jobMinutes", true);
  for (const budget of budgets) {
    check(budget.upTo, "a budget upTo");
    check(budget.ms, "a budget ms");
  }

  const sizesOf = new Map<string, Map<number, number>>();
  for (const entry of cells) {
    check(entry.size, `the size of job ${entry.job}`, true);
    if (!(Number.isInteger(entry.cells) && entry.cells >= 0)) throw new RangeError(`runCost: job ${entry.job} has ${entry.cells} cells at the size ${entry.size}, which is not a whole number of 0 or more.`);
    const sizes = sizesOf.get(entry.job) ?? new Map<number, number>();
    sizesOf.set(entry.job, sizes);
    if (sizes.has(entry.size)) throw new RangeError(`runCost: job ${entry.job} has two entries of cells at the size ${entry.size}.`);
    sizes.set(entry.size, entry.cells);
  }

  const timesOf = new Map<string, Map<string, Map<number, number[]>>>();
  for (const probe of probes) {
    check(probe.size, `the probe size of job ${probe.job}`, true);
    check(probe.ms, `the probe time of job ${probe.job} at the size ${probe.size}`);
    const jobs = timesOf.get(probe.model) ?? new Map<string, Map<number, number[]>>();
    timesOf.set(probe.model, jobs);
    const sizes = jobs.get(probe.job) ?? new Map<number, number[]>();
    jobs.set(probe.job, sizes);
    const values = sizes.get(probe.size) ?? [];
    sizes.set(probe.size, values);
    values.push(probe.ms);
  }

  const jobs = [...sizesOf.keys()].sort();
  const models: ModelCost[] = [];
  for (const model of [...timesOf.keys()].sort()) {
    const byJob = timesOf.get(model) as Map<string, Map<number, number[]>>;
    const costs: JobCost[] = [];
    const missing: string[] = [];
    for (const job of jobs) {
      const probed = byJob.get(job);
      if (probed === undefined) {
        missing.push(job);
        continue;
      }
      const points = [...probed.entries()].filter(([size]) => size > 0).map(([size, values]) => [size, mean(values)] as const).sort((a, b) => a[0] - b[0]);
      const atZero = probed.get(0);
      const zero = atZero === undefined ? undefined : mean(atZero);
      let ms = 0;
      let count = 0;
      let stopsAt: number | undefined;
      const extrapolated: number[] = [];
      const sizes = [...(sizesOf.get(job) as Map<number, number>).entries()].sort((a, b) => a[0] - b[0]);
      for (const [size, n] of sizes) {
        if (n === 0) continue;
        const [time, outside] = timeAt(points, zero, size);
        if (outside) extrapolated.push(size);
        const cellMs = time * (options.slow !== undefined && time > options.slow.ms ? options.slow.calls : options.calls);
        const budget = budgetAt(budgets, size);
        if (budget !== undefined && cellMs > budget) {
          ms += Math.min(overruns, n) * budget;
          stopsAt = size;
          break;
        }
        ms += n * cellMs;
        count += n;
      }
      const callMinutes = ms / 60_000;
      costs.push({ job, minutes: callMinutes * overhead + jobMinutes, callMinutes, cells: count, stopsAt, extrapolated });
    }
    models.push({ model, minutes: costs.reduce((sum, cost) => sum + cost.minutes, 0), jobs: costs, missing });
  }
  const whole = models.filter((model) => model.missing.length === 0).map((model) => model.minutes);
  return { models, low: whole.length === 0 ? undefined : Math.min(...whole), high: whole.length === 0 ? undefined : Math.max(...whole) };
}
