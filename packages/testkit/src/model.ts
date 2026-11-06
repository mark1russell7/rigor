/**
 * Model-based tests on `fast-check`. A test runs random sequences of steps against an implementation and a plain model.
 * It examines the two after each step.
 */

import fc from "fast-check";

/** One operation of a sequence. It changes the implementation and the model in the same way. */
export interface Step<S, M> {
  readonly label: string;
  run(sut: S, model: M): void;
}

/** The options of `runModel`. */
export interface RunModelOptions<S, M> {
  /** This function makes a new implementation and a new model for each run. */
  create: () => { sut: S; model: M };
  /** This arbitrary gives one step. */
  steps: fc.Arbitrary<Step<S, M>>;
  /** This function compares the implementation with the model. It throws when they do not agree. */
  check: (sut: S, model: M) => void;
  /** The maximum number of steps in a sequence. The default is 120. */
  maxSteps?: number;
  /** The number of runs. The default is 200. A value in `parameters` replaces it. */
  numRuns?: number;
  /** This function releases the implementation after each run, for example its timers. It runs also when a check throws. */
  dispose?: (sut: S) => void;
  /**
   * This function runs before each run, the runs of a shrink included.
   * Use it to clear a spy, so that the spy keeps only the calls of one run.
   */
  clear?: () => void;
  /** More parameters of `fc.assert`, for example `seed`. */
  parameters?: fc.Parameters<[Step<S, M>[]]>;
}

/**
 * This function runs random sequences of steps against a new implementation and a new model.
 * It calls `check` before the first step and after each step. `fast-check` shrinks a failure to a short sequence.
 */
export function runModel<S, M>(options: RunModelOptions<S, M>): void {
  const maxSteps = options.maxSteps ?? 120;
  fc.assert(
    // The default size of fast-check ("small") gives arrays of about 10 elements, whatever maxLength is.
    // The size "medium" gives sequences up to maxSteps long, so a failure that needs many steps comes up.
    fc.property(fc.array(options.steps, { maxLength: maxSteps, size: "medium" }), (steps) => {
      options.clear?.();
      const { sut, model } = options.create();
      try {
        options.check(sut, model);
        for (const step of steps) {
          step.run(sut, model);
          options.check(sut, model);
        }
      } finally {
        options.dispose?.(sut);
      }
    }),
    { numRuns: options.numRuns ?? 200, ...options.parameters },
  );
}

/** This function makes a step. The label shows in the counterexample of a failure. */
export function step<S, M>(label: string, run: (sut: S, model: M) => void): Step<S, M> {
  return { label, run, toString: () => label } as Step<S, M>;
}
