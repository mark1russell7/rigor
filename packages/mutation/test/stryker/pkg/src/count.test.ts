// The test of the stop check. Each test waits, so the run of all the mutants is long, and the stop comes first.
import { setTimeout } from "node:timers/promises";
import { expect, it } from "vitest";
import { clamp, grade, total } from "./count.ts";

it("grades a score", async () => {
  await setTimeout(1500);
  expect([95, 85, 75, 65, 10].map(grade)).toEqual(["A", "B", "C", "D", "F"]);
});

it("clamps a value", async () => {
  await setTimeout(1500);
  expect([clamp(-1, 0, 10), clamp(5, 0, 10), clamp(11, 0, 10)]).toEqual([0, 5, 10]);
});

it("adds the positive values", async () => {
  await setTimeout(1500);
  expect(total([1, -2, 3])).toBe(4);
});
