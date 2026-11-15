// This file installs a global plugin of fast-check. It has no uninstall, so the test has its own file.
import fc from "fast-check";
import { expect, it } from "vitest";
import { runModel, step } from "./model.ts";

it("runs a global beforeEach plugin and the option clear, each one time before each run", () => {
  const order: string[] = [];
  fc.installGlobalPlugin(fc.beforeEach(() => {
    order.push("plugin");
  }));
  runModel({
    create: () => {
      order.push("create");
      return { sut: null, model: null };
    },
    steps: fc.constant(step("none", () => {})),
    check: () => {},
    clear: () => {
      order.push("clear");
    },
    numRuns: 5,
  });
  expect(order).toEqual(Array.from({ length: 5 }, () => ["plugin", "clear", "create"]).flat());
});
