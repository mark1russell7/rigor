// The shrinking of a failed point of an input family (R9). Each dimension moves toward its target while the point still
// fails. The core is a generator: it gives each point to check, and the caller gives back `true` for a point that fails.
// Thus one core serves a check in this process and a check that waits, for example a child process.
import { type Dimension, type InputFamily, type Point, checkDimension, familyNames } from "./designs.ts";

/** The default count of the most checks of one shrink, with the check of the first point. */
export const SHRINK_CHECKS = 1000;

/** The default width of the last interval of a bisection, as a share of the range of a dimension that is not an integer. */
export const SHRINK_TOLERANCE = 1e-6;

/** The options of a shrink. */
export interface ShrinkOptions {
  /** The most checks of points, with the check of the first point. The default is `SHRINK_CHECKS`. */
  readonly maxChecks?: number;
  /**
   * The width of the last interval of a bisection on a dimension that is not an integer, as a share of its range. A log
   * dimension uses the range of the logarithm. The default is `SHRINK_TOLERANCE`.
   */
  readonly tolerance?: number;
}

/** One move of a shrink: the dimension, its value before the move and its value after the move. */
export interface ShrinkStep {
  readonly dimension: string;
  readonly from: number;
  readonly to: number;
}

/** The result of a shrink. */
export interface Shrunk {
  /** The last point that failed. Each key of the first point stays. */
  readonly point: Point;
  /** The moves, in their order. */
  readonly steps: readonly ShrinkStep[];
  /** The count of checks, with the check of the first point. */
  readonly checks: number;
  /** The value `true` tells that the budget of checks ended before a round with no move. */
  readonly exhausted: boolean;
}

/** This function gives the target of a dimension: the value of its range nearest to 0. */
export function shrinkTarget(dimension: Dimension): number {
  if (dimension.min > 0) return dimension.min;
  if (dimension.max < 0) return dimension.max;
  return 0;
}

/** This function examines a dimension and the value of the first point in it. A bad value is a `RangeError`. */
function checkValue(family: string, dim: Dimension, value: number | undefined): void {
  checkDimension(family, dim);
  const where = `shrinkPoint: ${family}.${dim.name}`;
  if (typeof value !== "number" || !(value >= dim.min && value <= dim.max)) throw new RangeError(`${where}: the value ${value} is not in the range ${dim.min} to ${dim.max}.`);
  if (dim.integer === true && !Number.isSafeInteger(value)) throw new RangeError(`${where}: the value ${value} is not an integer.`);
}

/** This function tells if a bisection on a dimension can stop: the values `good` and `bad` are near enough. */
function near(dim: Dimension, good: number, bad: number, tolerance: number): boolean {
  if (dim.integer === true) return Math.abs(good - bad) <= 1;
  if (dim.scale === "log") return Math.abs(Math.log(good / bad)) <= tolerance * Math.log(dim.max / dim.min);
  return Math.abs(good - bad) <= tolerance * (dim.max - dim.min);
}

/** This function gives the value between `bad` and `good` for the next check: the middle on the scale of the dimension. */
function middle(dim: Dimension, good: number, bad: number): number {
  if (dim.scale === "log") {
    const mid = Math.sqrt(good * bad);
    return dim.integer === true ? Math.round(mid) : mid;
  }
  return dim.integer === true ? bad + Math.trunc((good - bad) / 2) : bad + (good - bad) / 2;
}

/**
 * This generator is the core of a shrink. It gives each point to check, and it takes `true` back for a point that fails.
 * Its return value is the result.
 */
function* shrinkCore(family: InputFamily, first: Point, options: ShrinkOptions): Generator<Point, Shrunk, boolean> {
  const maxChecks = options.maxChecks ?? SHRINK_CHECKS;
  const tolerance = options.tolerance ?? SHRINK_TOLERANCE;
  if (!Number.isSafeInteger(maxChecks) || maxChecks < 1) throw new RangeError(`shrinkPoint: maxChecks is a whole number of 1 or more, not ${maxChecks}.`);
  if (!(tolerance > 0 && tolerance < 1)) throw new RangeError(`shrinkPoint: the tolerance is above 0 and below 1, not ${tolerance}.`);
  familyNames(family);
  for (const dim of family.dimensions) checkValue(family.name, dim, first[dim.name]);
  let point: Point = { ...first };
  const steps: ShrinkStep[] = [];
  let checks = 1;
  if (!(yield point)) throw new RangeError(`shrinkPoint: the first point of ${family.name} does not fail.`);
  const result = (exhausted: boolean): Shrunk => ({ point, steps, checks, exhausted });
  // The function `move` keeps a value that failed, and records the step.
  const move = (dim: Dimension, from: number, to: number): void => {
    point = { ...point, [dim.name]: to };
    steps.push({ dimension: dim.name, from, to });
  };
  for (let moved = true; moved; ) {
    moved = false;
    for (const dim of family.dimensions) {
      const from = point[dim.name]!;
      const target = shrinkTarget(dim);
      if (from === target) continue;
      if (checks >= maxChecks) return result(true);
      checks++;
      if (yield { ...point, [dim.name]: target }) {
        move(dim, from, target);
        moved = true;
        continue;
      }
      // The value `good` fails, and the value `bad` does not fail. The bisection keeps the two near the edge of the failure.
      let good = from;
      let bad = target;
      let ended = false;
      while (!near(dim, good, bad, tolerance)) {
        const mid = middle(dim, good, bad);
        if (mid === good || mid === bad) break;
        if (checks >= maxChecks) {
          ended = true;
          break;
        }
        checks++;
        if (yield { ...point, [dim.name]: mid }) good = mid;
        else bad = mid;
      }
      if (good !== from) {
        move(dim, from, good);
        // A move of a double within the tolerance starts no new round. Else each round can move it a little, until the budget ends.
        if (dim.integer === true || !near(dim, good, from, tolerance)) moved = true;
      }
      if (ended) return result(true);
    }
  }
  return result(false);
}

/**
 * This function shrinks a point of a family that fails. Each dimension moves toward `shrinkTarget`, while the point still fails.
 * - In each round, each dimension first tries its target. Then a bisection on the scale of the dimension finds the edge of the failure.
 * - The rounds continue until a round has no move, or until the budget of checks ends.
 * - The function `fails` gives `true` for a point that fails. A first point that does not fail is a `RangeError`.
 * - The shrink has no random draws. Thus the same point and the same function give the same result.
 */
export function shrinkPoint(family: InputFamily, point: Point, fails: (point: Point) => boolean, options: ShrinkOptions = {}): Shrunk {
  const core = shrinkCore(family, point, options);
  let next = core.next();
  while (next.done !== true) next = core.next(fails(next.value) === true);
  return next.value;
}

/** This function is `shrinkPoint` for a function `fails` that gives a promise, for example a check in a child process. */
export async function shrinkPointAsync(family: InputFamily, point: Point, fails: (point: Point) => boolean | Promise<boolean>, options: ShrinkOptions = {}): Promise<Shrunk> {
  const core = shrinkCore(family, point, options);
  let next = core.next();
  while (next.done !== true) next = core.next((await fails(next.value)) === true);
  return next.value;
}
