// The test of the part b. Only the run of the part b starts it, because it loads only sign.ts.
import { expect, it } from "vitest";
import { isPositive } from "./sign.ts";

it("tells if a number is positive", () => {
  expect([isPositive(1), isPositive(0), isPositive(-1)]).toEqual([true, false, false]);
});
