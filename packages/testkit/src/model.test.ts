import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { runModel, step, type Step } from "./model.ts";

/** A stack under test. With `faultAt`, a push at that size loses its value. */
class Stack {
  readonly items: number[] = [];
  private readonly faultAt: number | undefined;
  constructor(faultAt?: number) {
    this.faultAt = faultAt;
  }
  push(value: number): void {
    if (this.items.length === this.faultAt) return;
    this.items.push(value);
  }
  pop(): number | undefined {
    return this.items.pop();
  }
}

const stackSteps: fc.Arbitrary<Step<Stack, number[]>> = fc.oneof(
  fc.integer({ min: 0, max: 9 }).map((value) => step(`push(${value})`, (sut: Stack, model: number[]) => {
    sut.push(value);
    model.push(value);
  })),
  fc.constant(step("pop", (sut: Stack, model: number[]) => {
    expect(sut.pop()).toBe(model.pop());
  })),
);

const sameItems = (sut: Stack, model: number[]): void => {
  expect(sut.items).toEqual(model);
};

/** This function runs `body` and gives the message of the error that it throws. */
const failure = (body: () => void): string => {
  try {
    body();
  } catch (error) {
    return String(error);
  }
  throw new Error("The property did not fail");
};

describe("runModel", () => {
  it("passes when the implementation agrees with the model", () => {
    runModel({ create: () => ({ sut: new Stack(), model: [] }), steps: stackSteps, check: sameItems });
  });

  it("shrinks a failure to the shortest sequence, with the labels of its steps", () => {
    const message = failure(() =>
      runModel({
        create: () => ({ sut: new Stack(3), model: [] }),
        steps: stackSteps,
        check: sameItems,
        parameters: { seed: 7 },
      }),
    );
    // The fault needs 4 pushes: three to reach the size 3, and one that it loses. The shrink also makes each value 0.
    expect(message).toContain("[push(0),push(0),push(0),push(0)]");
  });

  it("gives sequences that reach maxSteps, and none that is longer", () => {
    const lengths: number[] = [];
    const counting = fc.constant(step("tick", (sut: { count: number }) => {
      sut.count += 1;
    }));
    runModel({
      create: () => ({ sut: { count: 0 }, model: null }),
      steps: counting,
      check: () => {},
      dispose: (sut) => lengths.push(sut.count),
      maxSteps: 40,
      numRuns: 300,
      parameters: { seed: 11 },
    });
    expect(Math.max(...lengths)).toBe(40);
    // The default size of fast-check gives sequences of about 10 steps. With it, 30 steps or more do not come up.
    expect(lengths.filter((length) => length >= 30).length).toBeGreaterThan(10);
  });

  it("calls check before the first step and after each step", () => {
    const counts = { steps: 0, checks: 0 };
    runModel({
      create: () => ({ sut: counts, model: null }),
      steps: fc.constant(step("tick", (sut: typeof counts) => {
        sut.steps += 1;
      })),
      check: (sut) => {
        sut.checks += 1;
      },
      clear: () => {
        // The check of each run is one more than its steps
        expect(counts.checks).toBe(counts.steps + (counts.checks === 0 ? 0 : 1));
        counts.steps = 0;
        counts.checks = 0;
      },
      numRuns: 50,
    });
    expect(counts.checks).toBe(counts.steps + 1);
  });

  it("gives the parameters to fast-check, and a numRuns in them replaces the option", () => {
    let runs = 0;
    runModel({
      create: () => {
        runs += 1;
        return { sut: null, model: null };
      },
      steps: fc.constant(step("none", () => {})),
      check: () => {},
      numRuns: 100,
      parameters: { numRuns: 7 },
    });
    expect(runs).toBe(7);
  });

  it("disposes each implementation once, also in the runs of a shrink and when a check throws", () => {
    let created = 0;
    const disposed = new Set<Stack>();
    failure(() =>
      runModel({
        create: () => {
          created += 1;
          return { sut: new Stack(2), model: [] };
        },
        steps: stackSteps,
        check: sameItems,
        dispose: (sut) => {
          expect(disposed.has(sut)).toBe(false);
          disposed.add(sut);
        },
        parameters: { seed: 3 },
      }),
    );
    expect(created).toBeGreaterThan(1);
    expect(disposed.size).toBe(created);
  });
});

describe("runModel with clear", () => {
  /** A spy keeps each call. Without a clear, it keeps the calls of all the runs. */
  const spy = { calls: [] as number[] };
  const spySteps = fc.integer({ min: 0, max: 9 }).map((value) => step(`call(${value})`, (_sut: null, model: number[]) => {
    spy.calls.push(value);
    model.push(value);
  }));

  it("clears the spy before each run, so the spy keeps only the calls of one run", () => {
    spy.calls.length = 0;
    runModel({
      create: () => ({ sut: null, model: [] }),
      steps: spySteps,
      check: (_sut, model) => expect(spy.calls).toEqual(model),
      clear: () => {
        spy.calls.length = 0;
      },
      numRuns: 20,
      parameters: { seed: 5 },
    });
  });

  it("runs clear before each run of a failing property, the runs of a shrink included", () => {
    let created = 0;
    let cleared = 0;
    const message = failure(() =>
      runModel({
        create: () => {
          // The clear of this run comes before the create
          expect(cleared).toBe(created + 1);
          created += 1;
          return { sut: new Stack(2), model: [] };
        },
        steps: stackSteps,
        check: sameItems,
        clear: () => {
          cleared += 1;
        },
        parameters: { seed: 3 },
      }),
    );
    expect(message).toContain("[push(0),push(0),push(0)]");
    expect(created).toBeGreaterThan(1);
    expect(cleared).toBe(created);
  });
});
