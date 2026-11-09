import { describe, expect, it } from "vitest";
import { type ChildStep, childRecords, childTimes, firstArm, pairedChild, pairedChildOrder } from "./index.ts";

const short = (order: readonly ChildStep[]): string => order.map((step) => `${step.pair === "aa" ? "aa." : ""}${step.source}`).join(" ");

describe("pairedChildOrder", () => {
  it("gives each pair in the order A B B A, and the first arm comes from firstArm", () => {
    expect(firstArm(0, 0)).toBe("a");
    expect(short(pairedChildOrder(0, 0, 1))).toBe("base candidate candidate base aa.base aa.copy aa.copy aa.base");
    expect(firstArm(1, 0)).toBe("b");
    expect(short(pairedChildOrder(1, 0, 1))).toBe("aa.copy aa.base aa.base aa.copy candidate base base candidate");
  });

  it("changes the places of the two blocks at each step", () => {
    const order = pairedChildOrder(0, 0, 2);
    expect(order.slice(0, 4).every((step) => step.pair === "candidate")).toBe(true);
    expect(order.slice(8, 12).every((step) => step.pair === "aa")).toBe(true);
  });

  it("gives each source of a pair the same count of samples, and each one starts first half of the time over two rounds", () => {
    for (const offset of [0, 1, 2]) {
      const both = [...pairedChildOrder(4, offset, 8), ...pairedChildOrder(5, offset, 8)];
      const count = (pair: string, source: string): number => both.filter((step) => step.pair === pair && step.source === source).length;
      expect([count("candidate", "base"), count("candidate", "candidate"), count("aa", "base"), count("aa", "copy")]).toEqual([32, 32, 32, 32]);
      const firstOfBlock = both.filter((_, index) => index % 4 === 0);
      expect(firstOfBlock.filter((step) => step.source === "base").length).toBe(firstOfBlock.length / 2);
    }
  });

  it("refuses a count of steps under 1 or not whole", () => {
    expect(() => pairedChildOrder(0, 0, 0)).toThrow(RangeError);
    expect(() => pairedChildOrder(0, 0, 1.5)).toThrow(RangeError);
  });
});

describe("childRecords", () => {
  it("gives each arm the median of its samples in its pair", () => {
    const order = pairedChildOrder(0, 0, 2);
    // A time for each source: base 10 + n, candidate 20 + n, copy 30 + n, where n counts the samples of the source in the pair
    const seen: Record<string, number> = {};
    const times = order.map((step) => {
      const key = `${step.pair}.${step.source}`;
      seen[key] = (seen[key] ?? 0) + 1;
      return { base: 10, candidate: 20, copy: 30 }[step.source] + (seen[key] ?? 0);
    });
    expect(childTimes(order, times).candidate.candidate).toEqual([21, 22, 23, 24]);
    expect(childRecords("one-10", 0, 0, order, times)).toEqual({
      candidate: { case: "one-10", round: 0, first: "a", a: 12.5, b: 22.5 },
      aa: { case: "one-10", round: 0, first: "a", a: 12.5, b: 32.5 },
    });
  });

  it("refuses a count of times that is not the count of samples", () => {
    expect(() => childRecords("one-10", 0, 0, pairedChildOrder(0, 0, 1), [1, 2])).toThrow(RangeError);
  });
});

describe("pairedChild", () => {
  it("takes one warm sample of each source, then the samples of the order, one at a time", async () => {
    const calls: string[] = [];
    let running = 0;
    const source = (name: string, ms: number) => async (tag: string): Promise<number> => {
      running++;
      expect(running).toBe(1);
      calls.push(`${name}:${tag}`);
      await Promise.resolve();
      running--;
      return ms;
    };
    const child = await pairedChild({ case: "one-10", round: 0, offset: 0, steps: 1, sample: { base: source("base", 10), candidate: source("candidate", 20), copy: source("copy", 30) } });
    expect(calls.slice(0, 3)).toEqual(["base:warm", "candidate:warm", "copy:warm"]);
    expect(calls.slice(3)).toEqual(["base:s0", "candidate:s1", "candidate:s2", "base:s3", "base:s4", "copy:s5", "copy:s6", "base:s7"]);
    expect(child.times).toEqual([10, 20, 20, 10, 10, 30, 30, 10]);
    expect(child.records).toEqual({
      candidate: { case: "one-10", round: 0, first: "a", a: 10, b: 20 },
      aa: { case: "one-10", round: 0, first: "a", a: 10, b: 30 },
    });
  });
});
