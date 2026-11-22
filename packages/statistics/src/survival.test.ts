import { describe, expect, it } from "vitest";
import { kaplanMeier, survivalAt, survivalQuantile, type TimeToEvent } from "./survival.ts";

// The remission times in weeks of the 6-MP group of Freireich and others (1963). A `+` time is censored.
const SIX_MP = "6 6 6 6+ 7 9+ 10 10+ 11+ 13 16 17+ 19+ 20+ 22 23 25+ 32+ 32+ 34+ 35+";
const observations: TimeToEvent[] = SIX_MP.split(" ").map((item) => ({ time: Number.parseFloat(item), censored: item.endsWith("+") }));

describe("kaplanMeier", () => {
  it("gives the textbook estimate and the Greenwood errors of the 6-MP group", () => {
    const curve = kaplanMeier(observations);
    expect(curve.steps.map((step) => [step.time, step.atRisk, step.events])).toEqual([
      [6, 21, 3],
      [7, 17, 1],
      [10, 15, 1],
      [13, 12, 1],
      [16, 11, 1],
      [22, 7, 1],
      [23, 6, 1],
    ]);
    const chances = [0.8571, 0.8067, 0.7529, 0.6902, 0.6275, 0.5378, 0.4482];
    const errors = [0.0764, 0.0869, 0.0963, 0.1068, 0.1141, 0.1282, 0.1346];
    curve.steps.forEach((step, index) => {
      expect(step.chance).toBeCloseTo(chances[index] ?? Number.NaN, 4);
      expect(step.se).toBeCloseTo(errors[index] ?? Number.NaN, 4);
    });
    expect([curve.count, curve.events, curve.censored, curve.last]).toEqual([21, 9, 12, 35]);
  });

  it("gives the same curve for grouped times", () => {
    const groups = new Map<string, TimeToEvent & { count: number }>();
    for (const observation of observations) {
      const key = `${String(observation.time)}${observation.censored === true ? "+" : ""}`;
      const group = groups.get(key) ?? { ...observation, count: 0 };
      groups.set(key, { ...group, count: group.count + 1 });
    }
    expect(kaplanMeier([...groups.values()].reverse())).toEqual(kaplanMeier(observations));
  });

  it("gives the share of the times above each time when no time is censored", () => {
    const curve = kaplanMeier([3, 1, 2, 2].map((time) => ({ time })));
    expect(curve.steps.map((step) => [step.time, step.chance])).toEqual([
      [1, 0.75],
      [2, 0.25],
      [3, 0],
    ]);
    expect(curve.steps[2]?.se).toBe(0);
  });

  it("refuses an empty list, a negative time, a time that is not finite and a wrong count", () => {
    expect(() => kaplanMeier([])).toThrow(RangeError);
    expect(() => kaplanMeier([{ time: -1 }])).toThrow(RangeError);
    expect(() => kaplanMeier([{ time: Number.POSITIVE_INFINITY }])).toThrow(RangeError);
    expect(() => kaplanMeier([{ time: 1, count: 1.5 }])).toThrow(RangeError);
    expect(() => kaplanMeier([{ time: 1, count: 0 }])).toThrow(RangeError);
  });
});

describe("survivalAt and survivalQuantile", () => {
  const curve = kaplanMeier(observations);

  it("gives the chance of the step function, and no read after a last censored time", () => {
    expect(survivalAt(curve, 0)).toBe(1);
    expect(survivalAt(curve, 5.9)).toBe(1);
    expect(survivalAt(curve, 6)).toBeCloseTo(0.8571, 4);
    expect(survivalAt(curve, 34)).toBeCloseTo(0.4482, 4);
    expect(survivalAt(curve, 35)).toBeCloseTo(0.4482, 4);
    expect(survivalAt(curve, 36)).toBeUndefined();
    expect(survivalAt(kaplanMeier([{ time: 1 }, { time: 2 }]), 9)).toBe(0);
    expect(() => survivalAt(curve, -1)).toThrow(RangeError);
  });

  it("gives the median 23 of the 6-MP group, and no read for a chance that the curve does not get to", () => {
    expect(survivalQuantile(curve, 0.5)).toBe(23);
    expect(survivalQuantile(curve, 0.9)).toBe(6);
    expect(survivalQuantile(curve, 0.4)).toBeUndefined();
    expect(survivalQuantile(kaplanMeier([1, 2, 3, 4].map((time) => ({ time }))), 0.5)).toBe(2);
    expect(() => survivalQuantile(curve, 1)).toThrow(RangeError);
  });
});
