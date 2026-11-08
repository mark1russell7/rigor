// The test of the part a. Only the run of the part a starts it, because it loads only add.ts.
import { expect, it } from "vitest";
import { add } from "./add.ts";

it("adds two numbers", () => {
  expect(add(2, 3)).toBe(5);
});
