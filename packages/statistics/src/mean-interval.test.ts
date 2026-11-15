import { describe, expect, it } from "vitest";
import { random } from "@mark1russell7/rigor-generators";
import { meanInterval } from "./mean-interval.ts";

describe("meanInterval", () => {
  it("gives the mean plus or minus t times the standard error", () => {
    // 1 to 5: mean 3, sd sqrt(2.5), and t(0.975, 4) = 2.776445 from the t table.
    const i = meanInterval([1, 2, 3, 4, 5]);
    expect(i.mean).toBe(3);
    expect(i.df).toBe(4);
    expect(i.t).toBeCloseTo(2.776445, 5);
    expect(i.half).toBeCloseTo((2.776445 * Math.sqrt(2.5)) / Math.sqrt(5), 5);
    expect(i.low).toBeCloseTo(3 - i.half, 12);
    expect(i.high).toBeCloseTo(3 + i.half, 12);
  });

  it("uses the one-sided 0.95 quantile at the level 0.9", () => {
    // t(0.95, 9) = 1.833113 from the t table.
    expect(meanInterval([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 0.9).t).toBeCloseTo(1.833113, 5);
  });

  it("gives a half width of 0 for equal values", () => {
    expect(meanInterval([0.1, 0.1, 0.1])).toMatchObject({ mean: 0.1, half: 0, low: 0.1, high: 0.1 });
  });

  it("covers the true mean in the share of the level", () => {
    // 4000 lists of 5 normal values from a fixed seed. The share has a standard error of approximately 0.0034.
    const r = random("rigor-statistics/meanInterval/coverage");
    let hits = 0;
    const lists = 4000;
    for (let k = 0; k < lists; k++) {
      const i = meanInterval(Array.from({ length: 5 }, () => r.normal(10, 2)));
      if (i.low <= 10 && 10 <= i.high) hits += 1;
    }
    expect(Math.abs(hits / lists - 0.95)).toBeLessThan(0.015);
  });

  it("refuses fewer than 2 values, a bad level and a value that is not finite", () => {
    expect(() => meanInterval([1])).toThrow(/2 values or more/);
    expect(() => meanInterval([1, 2], 1)).toThrow(/level/);
    expect(() => meanInterval([1, 2], 0)).toThrow(/level/);
    expect(() => meanInterval([1, Number.NaN])).toThrow(RangeError);
  });
});
