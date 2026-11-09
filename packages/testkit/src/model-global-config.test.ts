// This file changes the global configuration of fast-check, so the tests have their own file.
import fc from "fast-check";
import { afterEach, expect, it } from "vitest";
import { runModel, step } from "./model.ts";

afterEach(() => {
  fc.resetConfigureGlobal();
});

/** This function starts a model test with no steps, and gives the number of its runs. */
function countRuns(numRuns?: number): number {
  let runs = 0;
  runModel({
    create: () => {
      runs += 1;
      return { sut: null, model: null };
    },
    steps: fc.constant(step("none", () => {})),
    check: () => {},
    ...(numRuns === undefined ? {} : { numRuns }),
  });
  return runs;
}

it("uses the global numRuns of fast-check when the option numRuns is absent", () => {
  fc.configureGlobal({ numRuns: 7 });
  expect(countRuns()).toBe(7);
});

it("uses the option numRuns before the global numRuns", () => {
  fc.configureGlobal({ numRuns: 7 });
  expect(countRuns(3)).toBe(3);
});

it("uses 200 runs when the option and the global configuration have no numRuns", () => {
  expect(countRuns()).toBe(200);
});
